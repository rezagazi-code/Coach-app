/**
 * CoachPanel — the signed-in ACTIVE coach's home (JOB 1 routing fix).
 *
 * An approved coach must never land on the athlete questionnaire/tabs:
 * App's Root sends role 'coach'/'admin' (or any resolved coach profile)
 * here instead of the athlete Shell. Two sections:
 *
 *  صف بازبینی (Review queue) — pending program submissions from the v1
 *  review_queue table (decision IS NULL), joined to program + athlete.
 *  The card is skimmable from the frozen flags_snapshot: athlete name,
 *  track, BMI, injury red flag. Tap → detail with the questionnaire
 *  answers summary + approve/reject (decideReview helper).
 *
 *  شاگردهای من (My athletes) — the coach's athletes (RLS-scoped
 *  listAthletes). Each card carries the «نظر مربی / ضعف‌های بدنی» note:
 *  saved to programs.coach_notes on the athlete's newest program (the
 *  field program drafting reads, together with the questionnaire), or
 *  kept in local storage when no program exists yet / in demo mode.
 *
 * When the Supabase env is unconfigured the panel runs on clearly-labeled
 * demo data — no crashes, no fake persistence claims.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLang, type Lang } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import Toast from './Toast';
import {
  decideReview,
  isSupabaseConfigured,
  latestProgramFor,
  latestQuestionnaireResponse,
  listAthletes,
  listPendingReviews,
  updateProgramCoachNotes,
  type Athlete,
  type Program,
  type Track,
} from '../lib/supabase';

interface ReviewCard {
  key: string;
  programId: string | null; // null only in demo mode
  athleteId: string;
  athleteName: string;
  track: Track;
  submittedAt: string | null;
  flags: Record<string, unknown>;
  demoAnswers?: Record<string, unknown>;
}

interface AthleteCard {
  athlete: Athlete;
  program: Program | null;
}

const NOTES_KEY = 'km.coachNotes.v1';

function readLocalNotes(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}') as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalNotes(notes: Record<string, string>) {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch {
    /* storage unavailable — note stays in memory this session */
  }
}

// flags jsonb is untyped — narrow defensively before rendering.
const asNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const asStr = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : typeof v === 'number' ? String(v) : null;
const NEGATIVE = new Set(['none', 'no', '-', 'ندارد', 'خیر']);
const asList = (v: unknown): string[] => {
  const raw = Array.isArray(v) ? v.map((x) => String(x)) : typeof v === 'string' && v ? [v] : [];
  return raw.map((s) => s.trim()).filter((s) => s !== '' && !NEGATIVE.has(s.toLowerCase()));
};

// ---------------------------------------------------------------------------
// Demo data (unconfigured mode only) — bilingual sample rows; ids are
// local-only and never reach the database.
// ---------------------------------------------------------------------------

function demoReviews(lang: Lang): ReviewCard[] {
  const fa = lang === 'fa';
  return [
    {
      key: 'demo-program-1',
      programId: null,
      athleteId: 'demo-athlete-1',
      athleteName: fa ? 'سارا محمدی' : 'Sara Mohammadi',
      track: 'gym',
      submittedAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
      flags: {
        bmi: 27.4,
        bmi_cat: fa ? 'اضافه‌وزن' : 'Overweight',
        age_band: '25–34',
        goal: fa ? 'کاهش وزن' : 'Fat loss',
        sleep_hours: 6.5,
        days_per_week: 3,
        injuries: [fa ? 'زانوی راست' : 'Right knee'],
        surgeries: [],
      },
      demoAnswers: {
        goal: fa ? 'کاهش وزن' : 'Fat loss',
        height_cm: 168,
        weight_kg: 77,
        experience: fa ? 'متوسط' : 'Intermediate',
        days: 3,
        injury: fa ? 'درد زانوی راست هنگام اسکوات' : 'Right knee pain when squatting',
      },
    },
    {
      key: 'demo-program-2',
      programId: null,
      athleteId: 'demo-athlete-2',
      athleteName: fa ? 'علی رضایی' : 'Ali Rezaei',
      track: 'padel',
      submittedAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
      flags: {
        bmi: 22.1,
        bmi_cat: fa ? 'طبیعی' : 'Normal',
        age_band: '18–24',
        goal: fa ? 'عملکرد پدل' : 'Padel performance',
        sleep_hours: 7.5,
        days_per_week: 4,
        injuries: [],
        surgeries: [],
      },
      demoAnswers: {
        goal: fa ? 'عملکرد پدل' : 'Padel performance',
        height_cm: 181,
        weight_kg: 72.5,
        experience: fa ? 'پیشرفته' : 'Advanced',
        days: 4,
        injury: fa ? 'ندارد' : 'None',
      },
    },
  ];
}

function demoAthleteCards(lang: Lang): AthleteCard[] {
  const fa = lang === 'fa';
  const now = new Date().toISOString();
  const mkAthlete = (id: string, name: string): Athlete => ({
    id,
    user_id: null,
    full_name: name,
    birth_date: null,
    gender: null,
    phone: null,
    coach_id: null,
    created_at: now,
  });
  const mkProgram = (
    id: string,
    athleteId: string,
    track: Track,
    status: Program['status']
  ): Program => ({
    id,
    athlete_id: athleteId,
    coach_id: null,
    status,
    created_by: 'ai',
    track,
    goal: 'fat_loss',
    split: 'fullbody_ab',
    days_per_week: 3,
    ai_summary: '',
    coach_notes: '',
    approved_at: null,
    created_at: now,
  });
  return [
    {
      athlete: mkAthlete('demo-athlete-1', fa ? 'سارا محمدی' : 'Sara Mohammadi'),
      program: mkProgram('demo-program-1', 'demo-athlete-1', 'gym', 'in_review'),
    },
    {
      athlete: mkAthlete('demo-athlete-2', fa ? 'علی رضایی' : 'Ali Rezaei'),
      program: mkProgram('demo-program-2', 'demo-athlete-2', 'padel', 'in_review'),
    },
    { athlete: mkAthlete('demo-athlete-3', fa ? 'مریم کریمی' : 'Maryam Karimi'), program: null },
  ];
}

// ---------------------------------------------------------------------------

export default function CoachPanel() {
  const { t, num, lang } = useLang();
  const auth = useAuth();
  const [view, setView] = useState<'queue' | 'athletes'>('queue');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reviews, setReviews] = useState<ReviewCard[]>([]);
  const [cards, setCards] = useState<AthleteCard[]>([]);
  const [detail, setDetail] = useState<ReviewCard | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown> | null>(null);
  const [answersLoading, setAnswersLoading] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [savingNoteFor, setSavingNoteFor] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const localNotes = useRef<Record<string, string>>(readLocalNotes());

  const showToast = useCallback((msg: string) => {
    setToast(null);
    requestAnimationFrame(() => setToast(msg));
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    if (!isSupabaseConfigured) {
      setReviews(demoReviews(lang));
      const demoCards = demoAthleteCards(lang);
      setCards(demoCards);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const c of demoCards) {
          if (!(c.athlete.id in next)) next[c.athlete.id] = localNotes.current[c.athlete.id] || '';
        }
        return next;
      });
      setLoading(false);
      return;
    }
    try {
      const [pending, athletes] = await Promise.all([listPendingReviews(), listAthletes()]);
      setReviews(
        pending.map((p) => ({
          key: p.program.id,
          programId: p.program.id,
          athleteId: p.program.athlete_id,
          athleteName: p.athlete?.full_name ?? '—',
          track: p.program.track,
          submittedAt: p.review.submitted_at,
          flags: p.review.flags_snapshot,
        }))
      );
      const withPrograms = await Promise.all(
        athletes.map(async (a) => ({
          athlete: a,
          program: await latestProgramFor(a.id).catch(() => null),
        }))
      );
      setCards(withPrograms);
      // Seed note drafts once per athlete: the program's saved note wins,
      // then the locally-kept note. Never overwrite an in-progress draft.
      setDrafts((prev) => {
        const next = { ...prev };
        for (const c of withPrograms) {
          if (!(c.athlete.id in next)) {
            next[c.athlete.id] = c.program?.coach_notes || localNotes.current[c.athlete.id] || '';
          }
        }
        return next;
      });
    } catch (err) {
      console.error('[coach-panel] load failed', err);
      setLoadError(true);
    }
    setLoading(false);
  }, [lang]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(async (card: ReviewCard) => {
    setDetail(card);
    setAnswers(card.demoAnswers ?? null);
    if (!isSupabaseConfigured) return;
    setAnswersLoading(true);
    try {
      const resp = await latestQuestionnaireResponse(card.athleteId);
      setAnswers(resp?.answers ?? null);
      // The response's own flags are fresher than the submit snapshot.
      if (resp && Object.keys(resp.flags).length > 0) {
        setDetail((d) => (d && d.key === card.key ? { ...d, flags: resp.flags } : d));
      }
    } catch (err) {
      console.error('[coach-panel] answers load failed', err);
      setAnswers(null);
    }
    setAnswersLoading(false);
  }, []);

  const decide = useCallback(
    async (decision: 'approved' | 'rejected') => {
      if (!detail || deciding) return;
      setDeciding(true);
      try {
        if (isSupabaseConfigured && detail.programId) {
          await decideReview({ program_id: detail.programId, decision });
        }
        setReviews((prev) => prev.filter((r) => r.key !== detail.key));
        showToast(t(decision === 'approved' ? 'cp.approved' : 'cp.rejected'));
        setDetail(null);
      } catch (err) {
        console.error('[coach-panel] decision failed', err);
        showToast(t('cp.actionError'));
      }
      setDeciding(false);
    },
    [detail, deciding, showToast, t]
  );

  const saveNote = useCallback(
    async (card: AthleteCard) => {
      const athleteId = card.athlete.id;
      const text = drafts[athleteId] ?? '';
      setSavingNoteFor(athleteId);
      // Always keep a local copy: it is the only store in demo mode and
      // the fallback until the athlete has a program row to carry it.
      localNotes.current = { ...localNotes.current, [athleteId]: text };
      writeLocalNotes(localNotes.current);
      if (isSupabaseConfigured && card.program) {
        try {
          await updateProgramCoachNotes(card.program.id, text);
          showToast(t('cp.noteSaved'));
        } catch (err) {
          console.error('[coach-panel] note save failed', err);
          showToast(t('cp.actionError'));
        }
      } else {
        showToast(t(isSupabaseConfigured ? 'cp.noteLocalOnly' : 'cp.noteSaved'));
      }
      setSavingNoteFor(null);
    },
    [drafts, showToast, t]
  );

  const fmtDate = (iso: string | null): string =>
    iso
      ? new Date(iso).toLocaleDateString(lang === 'fa' ? 'fa-IR' : 'en-GB', {
          day: 'numeric',
          month: 'short',
        })
      : '—';

  const fmtVal = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (Array.isArray(v)) return v.map(fmtVal).join(lang === 'fa' ? '، ' : ', ');
    if (typeof v === 'object') return JSON.stringify(v);
    if (typeof v === 'number') return num(v);
    return String(v);
  };

  /** Skimmable flag chips shared by queue cards + the detail header. */
  const flagChips = (card: ReviewCard) => {
    const f = card.flags;
    const bmi = asNum(f.bmi);
    const bmiCat = asStr(f.bmi_cat);
    const goal = asStr(f.goal);
    const sleep = asNum(f.sleep_hours ?? f.sleep);
    const days = asNum(f.days_per_week ?? f.days);
    const ageBand = asStr(f.age_band);
    const injuries = asList(f.injuries);
    return (
      <>
        <span className="cp-chips">
          <span className="cp-chip cp-chip-track">{t(`cp.track.${card.track}`)}</span>
          {bmi !== null && (
            <span className="cp-chip">
              {t('cp.bmi')}: {num(bmi.toFixed(1))}
              {bmiCat ? ` · ${bmiCat}` : ''}
            </span>
          )}
          {goal && (
            <span className="cp-chip">
              {t('cp.goal')}: {goal}
            </span>
          )}
          {days !== null && (
            <span className="cp-chip">
              {t('cp.daysPerWeek')}: {num(days)}
            </span>
          )}
          {sleep !== null && (
            <span className="cp-chip">
              {t('cp.sleep')}: {num(sleep)} {t('cp.hours')}
            </span>
          )}
          {ageBand && (
            <span className="cp-chip">
              {t('cp.ageBand')}: {ageBand}
            </span>
          )}
        </span>
        {injuries.length > 0 && (
          <span className="cp-redflag" role="alert">
            ⚠ {t('cp.redFlag')}: {injuries.join(lang === 'fa' ? '، ' : ', ')}
          </span>
        )}
      </>
    );
  };

  // ------------------------------------------------------------- detail view
  if (detail) {
    const surgeries = asList(detail.flags.surgeries);
    const answerEntries = answers ? Object.entries(answers) : [];
    return (
      <div className="cp-scroll">
        <div className="cp-block">
          <button type="button" className="auth-back" onClick={() => setDetail(null)}>
            {t('auth.back')}
          </button>
          <h1 className="auth-title">{detail.athleteName}</h1>
          <p className="auth-sub">
            {t('cp.submittedAt')}: {fmtDate(detail.submittedAt)}
          </p>
          {flagChips(detail)}
          {surgeries.length > 0 && (
            <div className="cp-chips">
              <span className="cp-chip cp-chip-warn">
                {t('cp.surgeries')}: {surgeries.join(lang === 'fa' ? '، ' : ', ')}
              </span>
            </div>
          )}

          <h2 className="section-title cp-section">{t('cp.answersTitle')}</h2>
          {answersLoading ? (
            <p className="cp-empty">{t('cp.loading')}</p>
          ) : answerEntries.length === 0 ? (
            <p className="cp-empty">{t('cp.noAnswers')}</p>
          ) : (
            <div className="card cp-answers">
              {answerEntries.map(([k, v]) => (
                <div className="cp-answer-row" key={k}>
                  <span className="cp-answer-key" dir="ltr">
                    {k}
                  </span>
                  <span className="cp-answer-val">{fmtVal(v)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="cp-actions">
            <button
              type="button"
              className="btn-primary cp-action"
              disabled={deciding}
              onClick={() => void decide('approved')}
            >
              {deciding ? t('auth.pleaseWait') : t('cp.approve')}
            </button>
            <button
              type="button"
              className="cp-danger cp-action"
              disabled={deciding}
              onClick={() => void decide('rejected')}
            >
              {t('cp.reject')}
            </button>
          </div>
        </div>
        <Toast msg={toast} />
      </div>
    );
  }

  // --------------------------------------------------------------- list view
  return (
    <div className="cp-scroll">
      <div className="cp-block">
        <h1 className="auth-title neon-rise">{t('cp.title')}</h1>
        {auth.coach?.display_name && <p className="auth-sub">{auth.coach.display_name}</p>}
        {auth.unconfigured && <div className="cp-demo-note">⚠ {t('cp.demoNote')}</div>}

        <div className="cp-seg" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'queue'}
            className={view === 'queue' ? 'cp-seg-btn active' : 'cp-seg-btn'}
            onClick={() => setView('queue')}
          >
            {t('cp.queue')}
            {reviews.length > 0 && <span className="cp-count">{num(reviews.length)}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'athletes'}
            className={view === 'athletes' ? 'cp-seg-btn active' : 'cp-seg-btn'}
            onClick={() => setView('athletes')}
          >
            {t('cp.athletes')}
          </button>
        </div>

        {loading ? (
          <p className="cp-empty">{t('cp.loading')}</p>
        ) : loadError ? (
          <div className="cp-error-box">
            <p>{t('cp.loadError')}</p>
            <button type="button" className="btn-primary cp-retry" onClick={() => void load()}>
              {t('cp.retry')}
            </button>
          </div>
        ) : view === 'queue' ? (
          reviews.length === 0 ? (
            <p className="cp-empty">{t('cp.queueEmpty')}</p>
          ) : (
            reviews.map((r) => (
              <button
                type="button"
                key={r.key}
                className="cp-card neon-rise"
                onClick={() => void openDetail(r)}
              >
                <span className="cp-card-head">
                  <span className="cp-athlete-name">{r.athleteName}</span>
                  <span className="cp-date">
                    {t('cp.submittedAt')}: {fmtDate(r.submittedAt)}
                  </span>
                </span>
                {flagChips(r)}
              </button>
            ))
          )
        ) : cards.length === 0 ? (
          <p className="cp-empty">{t('cp.athletesEmpty')}</p>
        ) : (
          cards.map((c) => (
            <div className="cp-card-static" key={c.athlete.id}>
              <div className="cp-card-head">
                <span className="cp-athlete-name">{c.athlete.full_name}</span>
                {c.program && (
                  <span className="cp-chip cp-chip-track">{t(`cp.track.${c.program.track}`)}</span>
                )}
              </div>
              {c.program && (
                <p className="cp-meta">
                  {t('cp.programStatus')}: {t(`cp.status.${c.program.status}`)}
                </p>
              )}
              <label className="auth-field">
                <span className="auth-label">{t('cp.noteLabel')}</span>
                <textarea
                  className="cp-note"
                  rows={3}
                  value={drafts[c.athlete.id] ?? ''}
                  placeholder={t('cp.notePlaceholder')}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [c.athlete.id]: e.target.value }))
                  }
                />
                <span className="auth-hint">{t('cp.noteHint')}</span>
              </label>
              <button
                type="button"
                className="btn-primary cp-save"
                disabled={savingNoteFor === c.athlete.id}
                onClick={() => void saveNote(c)}
              >
                {savingNoteFor === c.athlete.id ? t('auth.pleaseWait') : t('cp.saveNote')}
              </button>
            </div>
          ))
        )}
      </div>
      <Toast msg={toast} />
    </div>
  );
}
