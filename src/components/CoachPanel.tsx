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
import { FOOD_BANK, type FoodBankItem } from '../lib/foodBank';
import SupplementReviewSection from './SupplementReviewSection';
import {
  decideReview,
  deleteAthlete,
  isSupabaseConfigured,
  latestNutritionLogFor,
  latestNutritionTargetsFor,
  latestProgramFor,
  listAthletes,
  listPendingReviews,
  questionnaireResponseForReview,
  updateProgramCoachNotes,
  upsertNutritionTargets,
  type Athlete,
  type NutritionFoodItem,
  type NutritionPrescription,
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
// Program row each athlete's note was last seen on. The empty-server-note
// carry below must NOT fire when the program row is unchanged: same row +
// empty server note means the coach deliberately cleared the note from
// another session, not a resubmission (which mints a fresh row).
const NOTE_PROG_KEY = 'km.coachNoteProg.v1';

// ---------------------------------------------------------------------------
// «بشقاب روزانه» — coach-side nutrition program editor (per athlete).
// ---------------------------------------------------------------------------

interface PlateDraft {
  items: NutritionFoodItem[];
  rx: NutritionPrescription[];
}

const PLATE_COACH_LOCAL = 'km.plate.coach.v1';

function readLocalPlates(): Record<string, PlateDraft> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLATE_COACH_LOCAL) ?? '{}') as Record<
      string,
      PlateDraft
    >;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalPlates(plates: Record<string, PlateDraft>) {
  try {
    localStorage.setItem(PLATE_COACH_LOCAL, JSON.stringify(plates));
  } catch {
    /* ignore */
  }
}

const UNITS: NutritionFoodItem['unit'][] = ['g', 'pcs', 'cup', 'ml'];

/**
 * «انتخاب از بانک» (Pick from bank) — one dropdown + one button per plate
 * row. Prefills the row's name (FA/EN) and unit from the bank food; the
 * coach still sets the target amount themselves.
 */
function BankPicker({ onPick }: { onPick: (f: FoodBankItem) => void }) {
  const { t, lang } = useLang();
  const [picked, setPicked] = useState('');
  return (
    <div className="cp-bank-pick">
      <select
        className="cp-plate-input cp-bank-select"
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        aria-label={t('cp.bankPick')}
      >
        <option value="">{t('cp.bankChoose')}</option>
        {FOOD_BANK.map((f) => (
          <option key={f.id} value={f.id}>
            {lang === 'fa' ? f.nameFA : f.nameEN}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="cp-bank-btn"
        disabled={!picked}
        onClick={() => {
          const f = FOOD_BANK.find((x) => x.id === picked);
          if (f) onPick(f);
          setPicked('');
        }}
      >
        {t('cp.bankPick')}
      </button>
    </div>
  );
}

function demoPlate(): PlateDraft {
  return {
    items: [
      { key: 'chicken', label_fa: 'مرغ (سینه)', label_en: 'Chicken breast', unit: 'g', target: 200 },
      { key: 'rice', label_fa: 'برنج پخته', label_en: 'Cooked rice', unit: 'g', target: 300 },
    ],
    rx: [{ name_fa: 'ویتامین D', name_en: 'Vitamin D' }],
  };
}

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

function readLocalNotePrograms(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTE_PROG_KEY) ?? '{}') as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalNotePrograms(progs: Record<string, string>) {
  try {
    localStorage.setItem(NOTE_PROG_KEY, JSON.stringify(progs));
  } catch {
    /* storage unavailable — program tracking stays in memory this session */
  }
}

// Questionnaire answers are typed by Iranian users: Persian/Arabic-Indic
// digits and the ٫ decimal separator must normalize before Number(), or
// Number('۲۳٫۴') is NaN and the flag silently vanishes (PadelPro lesson:
// raw parseInt/Number on FA-digit input fails SILENTLY).
const faDigitsToLatin = (s: string): string =>
  s
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/٬/g, '');

// flags jsonb is untyped — narrow defensively before rendering.
const asNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(faDigitsToLatin(v.trim()));
    return Number.isFinite(n) ? n : null;
  }
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
    client_uuid: null,
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
  // Last program row id seen per athlete (see NOTE_PROG_KEY): persisted so
  // a note cleared from another session stays cleared across restarts.
  const localNotePrograms = useRef<Record<string, string>>(readLocalNotePrograms());
  // «بشقاب روزانه» nutrition program state (per athlete).
  const [plateOpen, setPlateOpen] = useState<Record<string, boolean>>({});
  const [plateDrafts, setPlateDrafts] = useState<Record<string, PlateDraft>>({});
  const [plateSaving, setPlateSaving] = useState<string | null>(null);
  // athleteId -> labels of food items eaten OVER target in recent logs.
  const [overFlags, setOverFlags] = useState<Record<string, string[]>>({});
  // «حذف شاگرد» — double-confirm delete: first tap arms the button,
  // second tap deletes. Armed per athlete id; deletingId tracks the
  // in-flight delete so the button can't be double-fired.
  const [deleteArmed, setDeleteArmed] = useState<Record<string, boolean>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const localPlates = useRef<Record<string, PlateDraft>>(readLocalPlates());
  // Athletes whose plate draft has UNSAVED edits (typed in the editor but
  // not yet saved). A foreground re-check must not clobber those — but it
  // must refresh every other athlete from the server, or targets changed
  // from another session never appear and a later save overwrites them
  // with the stale draft (the old `{...draftsNext, ...prev}` merge kept
  // the previous draft wholesale for every athlete).
  const plateDirty = useRef<Set<string>>(new Set());
  // Same guard for the coach note (see the plateDirty comment): typing
  // marks the athlete dirty, a persisted save clears it. Without this,
  // the seed-once merge below pinned the first-loaded note forever — a
  // note changed from another session never appeared here, and a later
  // save from here overwrote that session's change with the stale draft.
  const noteDirty = useRef<Set<string>>(new Set());
  // Guards the openDetail async fetch: an earlier card's response must not
  // overwrite the answers/flags of a card opened afterwards (coach taps A,
  // goes back, taps B — A's response resolving later would show A's
  // questionnaire answers under B's header while the coach decides).
  const detailKeyRef = useRef<string | null>(null);
  // Guards the fire-and-forget nutrition block in load(): overlapping load()
  // runs (e.g. language toggle mid-load) must not let the older fetch's
  // setOverFlags/setPlateDrafts wipe newer data. Same pattern as detailKeyRef.
  const loadSeqRef = useRef(0);

  const showToast = useCallback((msg: string) => {
    setToast(null);
    requestAnimationFrame(() => setToast(msg));
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // Silent foreground re-checks must not flash the loading state or an
  // error banner over a queue the coach is already looking at: a transient
  // read failure just leaves the last good queue in place.
  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setLoadError(false);
    }
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
      // Demo nutrition: sample program on athlete-1 + an over-eating flag,
      // so the coach sees the whole «بشقاب روزانه» loop in demo mode.
      setPlateDrafts((prev) => {
        const next = { ...prev };
        for (const c of demoCards) {
          if (!(c.athlete.id in next))
            next[c.athlete.id] =
              localPlates.current[c.athlete.id] ?? (c.athlete.id === 'demo-athlete-1' ? demoPlate() : { items: [], rx: [] });
        }
        return next;
      });
      setOverFlags({
        'demo-athlete-1': [lang === 'fa' ? 'مرغ (سینه)' : 'Chicken breast'],
      });
      if (!silent) setLoading(false);
      return;
    }
    const loadSeq = ++loadSeqRef.current;
    try {
      const [pending, athletes] = await Promise.all([listPendingReviews(), listAthletes()]);
      // Same stale-load guard as the nutrition block below: a load that
      // started BEFORE a coach decision (or a newer foreground load) must
      // not overwrite newer state when it resolves late — without this, a
      // just-decided review reappeared in the queue and a just-arrived
      // submission vanished until the next foreground refresh.
      if (loadSeq !== loadSeqRef.current) return;
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
      if (loadSeq !== loadSeqRef.current) return;
      setCards(withPrograms);
      // «بشقاب روزانه»: per athlete, load the current program (for the
      // editor drafts + resolving over-eating keys to labels) and the
      // latest daily log (for the over-eating red flag).
      // Stale-load guard: if a newer load() started while these fetches
      // were in flight, skip the state writes entirely.
      void (async () => {
        const seq = loadSeq;
        const draftsNext: Record<string, PlateDraft> = {};
        const overNext: Record<string, string[]> = {};
        // Athletes whose targets+log fetches BOTH succeeded. A failed
        // fetch must be distinguishable from "no row" (null): the old
        // catch-to-null collapsed them, so a transient failure blanked
        // the editor with the local fallback — empty on a device that
        // never saved this plate — and a save from that blank editor
        // then wiped the server plate with an empty upsert. The same
        // failure also cleared a real over-eating flag (no log entry in
        // overNext meant wholesale replace dropped it). Unresolved
        // athletes now keep their previous draft and flag instead.
        const resolvedIds = new Set<string>();
        await Promise.all(
          withPrograms.map(async (c) => {
            try {
              const [targets, log] = await Promise.all([
                latestNutritionTargetsFor(c.athlete.id),
                latestNutritionLogFor(c.athlete.id, 3),
              ]);
              resolvedIds.add(c.athlete.id);
              const items = targets?.food_items ?? [];
              const rx = targets?.prescriptions ?? [];
              // Server copy wins when the fetch succeeded: the local copy
              // is only the offline/fallback store (mirroring the
              // supplement-review pattern), so preferring it here pinned
              // the last plate saved ON THIS DEVICE and hid a plate
              // changed from another session — and a later save from
              // here then overwrote that other session's change with the
              // stale local copy. The dirty-set merge below still
              // protects genuinely unsaved edits.
              draftsNext[c.athlete.id] = {
                items: targets ? items : (localPlates.current[c.athlete.id]?.items ?? items),
                rx: targets ? rx : (localPlates.current[c.athlete.id]?.rx ?? rx),
              };
              if (log) {
                const overKeys = new Set(log.items.filter((i) => i.over).map((i) => i.key));
                const labels = items
                  .filter((it) => overKeys.has(it.key))
                  .map((it) => (lang === 'fa' ? it.label_fa : it.label_en));
                if (labels.length > 0) overNext[c.athlete.id] = labels;
              }
            } catch (err) {
              console.error('[coach-panel] nutrition load failed', err);
            }
          })
        );
        if (seq !== loadSeqRef.current) return; // stale load — a newer load() is in flight
        setPlateDrafts((prev) => {
          const next = { ...prev, ...draftsNext };
          // Only an unsaved in-progress edit keeps the previous draft;
          // every other athlete takes the freshly fetched server copy.
          // Unresolved athletes are absent from draftsNext, so their
          // previous draft survives a failed fetch untouched.
          for (const id of plateDirty.current) {
            if (id in prev) next[id] = prev[id];
          }
          return next;
        });
        setOverFlags((prev) => {
          const next = { ...prev };
          // Only resolved athletes update their flag: a failed fetch
          // preserves the last good flag instead of clearing a real
          // over-eating alert. Athletes no longer in the list (deleted)
          // drop theirs, keeping the old wholesale replace's cleanup.
          for (const id of resolvedIds) {
            if (id in overNext) next[id] = overNext[id];
            else delete next[id];
          }
          const liveIds = new Set(withPrograms.map((c) => c.athlete.id));
          for (const id of Object.keys(next)) {
            if (!liveIds.has(id)) delete next[id];
          }
          return next;
        });
      })();
      // Coach-note drafts: a non-dirty athlete takes the freshly loaded
      // program note when it is non-empty (server wins, mirroring the
      // plate merge above), so a note changed from another session
      // appears here; only an unsaved in-progress edit keeps the
      // previous draft. An empty server note does NOT wipe the draft:
      // every resubmission creates a fresh program row with
      // coach_notes='' (supabase.ts), so falling back to the locally-kept
      // note — then the previous draft — carries the standing note
      // (weaknesses/limitations) across resubmissions instead of silently
      // blanking it, and is the only store until a program row exists.
      // ONE exception: the SAME program row seen before with an empty
      // server note means the coach deliberately cleared the note from
      // another session — the carry chain would otherwise resurrect it
      // from this device's local copy, and a later save here would undo
      // that session's clear (the plate trap just fixed). The snapshot
      // below is read inside the updater so the ref update after it
      // cannot make every row look "unchanged" (updaters must stay pure).
      const prevNotePrograms = { ...localNotePrograms.current };
      setDrafts((prev) => {
        const next = { ...prev };
        for (const c of withPrograms) {
          if (noteDirty.current.has(c.athlete.id)) continue;
          const prog = c.program;
          if (prog && prevNotePrograms[c.athlete.id] === prog.id && !prog.coach_notes) {
            next[c.athlete.id] = '';
          } else {
            next[c.athlete.id] =
              prog?.coach_notes ||
              localNotes.current[c.athlete.id] ||
              prev[c.athlete.id] ||
              '';
          }
        }
        return next;
      });
      // Record the program rows seen on this load (failed program fetches
      // resolve to null and leave the stored row untouched, so a transient
      // failure can never fake a resubmission). Persisted only on change.
      let noteProgChanged = false;
      for (const c of withPrograms) {
        if (c.program && localNotePrograms.current[c.athlete.id] !== c.program.id) {
          localNotePrograms.current[c.athlete.id] = c.program.id;
          noteProgChanged = true;
        }
      }
      if (noteProgChanged) writeLocalNotePrograms(localNotePrograms.current);
    } catch (err) {
      console.error('[coach-panel] load failed', err);
      // A stale load's failure must not paint an error banner over the
      // newer load's good data — the newer load reports its own result.
      if (!silent && loadSeq === loadSeqRef.current) setLoadError(true);
    } finally {
      // The stale-load early returns above must not strand loading=true:
      // a non-silent load that went stale (e.g. a silent foreground
      // re-check started while the first load was still in flight) used
      // to return without clearing loading, and the silent load never
      // touches it — so the panel sat on «در حال بارگذاری» forever even
      // though fresh data had arrived. finally matches the
      // SupplementReviewSection pattern.
      if (!silent) setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    void load();
    // Same trap class as the 0.2.29/0.2.30 trainee-side fixes, mirrored to
    // the coach side: CoachPanel is the coach's home screen and stays
    // mounted, so this effect runs once per app start — a trainee
    // submission arriving while the coach's app was open never appeared
    // in the review queue until restart. Re-check silently whenever the
    // app returns to the foreground: that is the realistic
    // submission-arrival moment (trainee submits, tells the coach, the
    // coach opens/foregrounds the app).
    const onForeground = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    return () => {
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
    };
  }, [load]);

  const openDetail = useCallback(async (card: ReviewCard) => {
    setDetail(card);
    detailKeyRef.current = card.key;
    setAnswers(card.demoAnswers ?? null);
    if (!isSupabaseConfigured) return;
    setAnswersLoading(true);
    try {
      // Tie the answers to THIS card's program, not the athlete's newest
      // response: a second submission (S2) must not leak its answers/flags
      // into the detail of the first submission's card (P1) while the
      // decision below still applies to P1.
      const resp = await questionnaireResponseForReview(card.athleteId, card.submittedAt);
      // Stale-response guard: only apply to the card still open.
      if (detailKeyRef.current !== card.key) return;
      setAnswers(resp?.answers ?? null);
      // The tied response's own flags refresh the card's frozen snapshot
      // (same submission — identical in practice).
      if (resp && Object.keys(resp.flags).length > 0) {
        setDetail((d) => (d && d.key === card.key ? { ...d, flags: resp.flags } : d));
      }
    } catch (err) {
      console.error('[coach-panel] answers load failed', err);
      if (detailKeyRef.current === card.key) setAnswers(null);
    }
    if (detailKeyRef.current === card.key) setAnswersLoading(false);
  }, []);

  const decide = useCallback(
    async (decision: 'approved' | 'rejected') => {
      if (!detail || deciding) return;
      // Invalidate any load in flight: c37a5dc guarded the list writes
      // against a NEWER load, but a decision never bumped the sequence —
      // so a silent foreground load that started BEFORE this tap still
      // passed the check and overwrote the filtered queue with its
      // pre-decision list, resurrecting the just-decided review. Bump
      // BEFORE the await so a load resolving mid-decision is discarded.
      loadSeqRef.current++;
      setDeciding(true);
      try {
        if (isSupabaseConfigured && detail.programId) {
          await decideReview({ program_id: detail.programId, decision });
        }
        setReviews((prev) => prev.filter((r) => r.key !== detail.key));
        // Keep the «شاگردهای من» tab in sync: the DB program row moved
        // (approved → 'approved' + approved_at; rejected → 'draft'), but
        // cards[] is only loaded once. Without this patch the athlete
        // card keeps showing «در حال بازبینی» after the coach just decided.
        const newStatus = decision === 'approved' ? 'approved' : 'draft';
        const newApprovedAt = decision === 'approved' ? new Date().toISOString() : null;
        setCards((prev) =>
          prev.map((c) =>
            c.program && c.program.id === (detail.programId ?? detail.key)
              ? {
                  ...c,
                  program: { ...c.program, status: newStatus, approved_at: newApprovedAt },
                }
              : c
          )
        );
        showToast(t(decision === 'approved' ? 'cp.approved' : 'cp.rejected'));
        detailKeyRef.current = null;
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
      if (!isSupabaseConfigured) {
        // Demo mode: the local copy IS the store, so the save persisted.
        noteDirty.current.delete(athleteId);
        showToast(t('cp.noteSaved'));
      } else {
        try {
          // Re-resolve the latest program at save time: card.program was
          // captured when the panel loaded and may be stale — approving a
          // pending review or an athlete resubmit in between leaves a newer
          // program row. Saving to the stale row would hide the note from
          // the athlete's current program and from fresh panel loads.
          const program = (await latestProgramFor(athleteId).catch(() => null)) ?? card.program;
          if (program) {
            await updateProgramCoachNotes(program.id, text);
            // Record the row just saved to (same guard as the load path
            // above): without this, a save landing on a NEWER row than
            // the panel last loaded leaves localNotePrograms pointing
            // at the old row — and a note cleared from another session
            // on the new row would then resurrect from the local copy
            // on the next load, which treats the row as "new" and
            // carries the standing note instead of blanking it.
            if (localNotePrograms.current[athleteId] !== program.id) {
              localNotePrograms.current = { ...localNotePrograms.current, [athleteId]: program.id };
              writeLocalNotePrograms(localNotePrograms.current);
            }
            // Clear dirty only on a persisted save (plateDirty rule): a
            // failed save — or a local-only save with no program row yet
            // — keeps the draft protected from foreground re-checks until
            // the coach retries and it actually lands on the server.
            noteDirty.current.delete(athleteId);
            showToast(t('cp.noteSaved'));
          } else {
            showToast(t('cp.noteLocalOnly'));
          }
        } catch (err) {
          console.error('[coach-panel] note save failed', err);
          showToast(t('cp.actionError'));
        }
      }
      setSavingNoteFor(null);
    },
    [drafts, showToast, t]
  );

  // ------------------------------------------------- «حذف شاگرد» (delete trainee)
  // Double-confirm: first tap arms the button ("tap again to confirm"),
  // second tap deletes the athletes row — FK cascades wipe all app data.
  // The auth.users login row cannot be deleted client-side; the success
  // toast tells the coach to remove it from the Supabase dashboard.
  const handleDeleteTrainee = useCallback(
    async (athleteId: string) => {
      if (!deleteArmed[athleteId]) {
        setDeleteArmed((prev) => ({ ...prev, [athleteId]: true }));
        return;
      }
      setDeleteArmed((prev) => ({ ...prev, [athleteId]: false }));
      setDeletingId(athleteId);
      // Same trap as decide above: invalidate any load in flight, or its
      // pre-delete lists resurrect the deleted athlete on resolve.
      loadSeqRef.current++;
      try {
        await deleteAthlete(athleteId);
        setCards((prev) => prev.filter((c) => c.athlete.id !== athleteId));
        // The review queue is a separate list — without this, a deleted
        // athlete with a pending review would leave a ghost card whose
        // detail opens on cascade-wiped rows (dead-end + error toast).
        setReviews((prev) => prev.filter((r) => r.athleteId !== athleteId));
        // The local stores are keyed by athlete id too — without cleanup
        // the deleted athlete's notes/plates linger in localStorage
        // forever as dead entries. Drop them and rewrite both keys.
        delete localNotes.current[athleteId];
        writeLocalNotes(localNotes.current);
        delete localNotePrograms.current[athleteId];
        writeLocalNotePrograms(localNotePrograms.current);
        delete localPlates.current[athleteId];
        writeLocalPlates(localPlates.current);
        plateDirty.current.delete(athleteId);
        noteDirty.current.delete(athleteId);
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[athleteId];
          return next;
        });
        setPlateDrafts((prev) => {
          const next = { ...prev };
          delete next[athleteId];
          return next;
        });
        showToast(t('cp.deleteTraineeDone') + ' — ' + t('cp.deleteTraineeAuthNote'));
      } catch (err) {
        console.error('[coach-panel] delete trainee failed', err);
        showToast(t('cp.deleteTraineeFail'));
      } finally {
        setDeletingId(null);
      }
    },
    [deleteArmed, showToast, t]
  );

  const fmtDate = (iso: string | null): string =>
    iso
      ? new Date(iso).toLocaleDateString(lang === 'fa' ? 'fa-IR' : 'en-GB', {
          day: 'numeric',
          month: 'short',
        })
      : '—';

  // ------------------------------------------------- «بشقاب روزانه» editor

  const patchPlateItem = useCallback(
    (athleteId: string, idx: number, patch: Partial<NutritionFoodItem>) => {
      plateDirty.current.add(athleteId);
      setPlateDrafts((prev) => {
        const draft = prev[athleteId] ?? { items: [], rx: [] };
        const items = draft.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
        return { ...prev, [athleteId]: { ...draft, items } };
      });
    },
    []
  );

  const addPlateItem = useCallback((athleteId: string) => {
    plateDirty.current.add(athleteId);
    setPlateDrafts((prev) => {
      const draft = prev[athleteId] ?? { items: [], rx: [] };
      const blank: NutritionFoodItem = {
        key: `k${Date.now()}`,
        label_fa: '',
        label_en: '',
        unit: 'g',
        target: 100,
      };
      return { ...prev, [athleteId]: { ...draft, items: [...draft.items, blank] } };
    });
  }, []);

  const removePlateItem = useCallback((athleteId: string, idx: number) => {
    plateDirty.current.add(athleteId);
    setPlateDrafts((prev) => {
      const draft = prev[athleteId] ?? { items: [], rx: [] };
      return { ...prev, [athleteId]: { ...draft, items: draft.items.filter((_, i) => i !== idx) } };
    });
  }, []);

  const patchRx = useCallback(
    (athleteId: string, idx: number, patch: Partial<NutritionPrescription>) => {
      plateDirty.current.add(athleteId);
      setPlateDrafts((prev) => {
        const draft = prev[athleteId] ?? { items: [], rx: [] };
        const rx = draft.rx.map((p, i) => (i === idx ? { ...p, ...patch } : p));
        return { ...prev, [athleteId]: { ...draft, rx } };
      });
    },
    []
  );

  const addRx = useCallback((athleteId: string) => {
    plateDirty.current.add(athleteId);
    setPlateDrafts((prev) => {
      const draft = prev[athleteId] ?? { items: [], rx: [] };
      return { ...prev, [athleteId]: { ...draft, rx: [...draft.rx, { name_fa: '', name_en: '' }] } };
    });
  }, []);

  const removeRx = useCallback((athleteId: string, idx: number) => {
    plateDirty.current.add(athleteId);
    setPlateDrafts((prev) => {
      const draft = prev[athleteId] ?? { items: [], rx: [] };
      return { ...prev, [athleteId]: { ...draft, rx: draft.rx.filter((_, i) => i !== idx) } };
    });
  }, []);

  const savePlate = useCallback(
    async (card: AthleteCard) => {
      const athleteId = card.athlete.id;
      const draft = plateDrafts[athleteId] ?? { items: [], rx: [] };
      const items: NutritionFoodItem[] = draft.items
        .filter((it) => it.label_fa.trim() !== '' && it.target > 0)
        .map((it, i) => ({
          ...it,
          key: it.key || `k${Date.now()}-${i}`,
          label_fa: it.label_fa.trim(),
          label_en: it.label_en.trim() || it.label_fa.trim(),
        }));
      const rx: NutritionPrescription[] = draft.rx
        .filter((p) => p.name_fa.trim() !== '')
        .map((p) => ({
          name_fa: p.name_fa.trim(),
          name_en: p.name_en.trim() || p.name_fa.trim(),
        }));
      setPlateSaving(athleteId);
      // Always keep a local copy (demo mode store + fallback).
      localPlates.current = { ...localPlates.current, [athleteId]: { items, rx } };
      writeLocalPlates(localPlates.current);
      setPlateDrafts((prev) => ({ ...prev, [athleteId]: { items, rx } }));
      if (!isSupabaseConfigured) {
        plateDirty.current.delete(athleteId);
        showToast(t('cp.nutritionSaved'));
      } else {
        try {
          await upsertNutritionTargets({
            athlete_id: athleteId,
            coach_id: auth.coach?.id ?? null,
            food_items: items,
            prescriptions: rx,
          });
          // Clear dirty only on success: a failed save keeps the draft
          // protected from foreground re-checks until the coach retries.
          plateDirty.current.delete(athleteId);
          showToast(t('cp.nutritionSaved'));
        } catch (err) {
          console.error('[coach-panel] nutrition save failed', err);
          showToast(t('cp.actionError'));
        }
      }
      setPlateSaving(null);
    },
    [plateDrafts, showToast, t, auth.coach]
  );

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
          <button
            type="button"
            className="auth-back"
            onClick={() => {
              detailKeyRef.current = null;
              setDetail(null);
            }}
          >
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
                  onChange={(e) => {
                    noteDirty.current.add(c.athlete.id);
                    setDrafts((prev) => ({ ...prev, [c.athlete.id]: e.target.value }));
                  }}
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

              {(overFlags[c.athlete.id]?.length ?? 0) > 0 && (
                <span className="cp-redflag plate-overflag" role="alert">
                  🍽 {t('cp.nutritionOver')}: {overFlags[c.athlete.id].join(lang === 'fa' ? '، ' : ', ')}
                  {' — '}
                  {t('cp.nutritionOverHint')}
                </span>
              )}

              <button
                type="button"
                className="btn-ghost cp-plate-toggle"
                aria-expanded={!!plateOpen[c.athlete.id]}
                onClick={() =>
                  setPlateOpen((prev) => ({ ...prev, [c.athlete.id]: !prev[c.athlete.id] }))
                }
              >
                🍽 {t('cp.nutritionTitle')}
              </button>

              {plateOpen[c.athlete.id] &&
                (() => {
                  const draft = plateDrafts[c.athlete.id] ?? { items: [], rx: [] };
                  return (
                    <div className="cp-plate">
                      {draft.items.length === 0 && (
                        <p className="cp-empty">{t('cp.nutritionEmpty')}</p>
                      )}
                      {draft.items.map((it, i) => (
                        <div className="cp-plate-row" key={it.key || i}>
                          <input
                            className="cp-plate-input"
                            value={it.label_fa}
                            placeholder={t('cp.nutritionNameFa')}
                            onChange={(e) => patchPlateItem(c.athlete.id, i, { label_fa: e.target.value })}
                          />
                          <input
                            className="cp-plate-input"
                            value={it.label_en}
                            placeholder={t('cp.nutritionNameEn')}
                            dir="ltr"
                            onChange={(e) => patchPlateItem(c.athlete.id, i, { label_en: e.target.value })}
                          />
                          <div className="cp-plate-numrow">
                            <input
                              className="cp-plate-input cp-plate-target"
                              value={it.target === 0 ? '' : String(it.target)}
                              placeholder={t('cp.nutritionTarget')}
                              inputMode="numeric"
                              onChange={(e) => {
                                const n = Number(faDigitsToLatin(e.target.value.trim()));
                                patchPlateItem(c.athlete.id, i, {
                                  target: Number.isFinite(n) && n >= 0 ? n : 0,
                                });
                              }}
                            />
                            <select
                              className="cp-plate-input cp-plate-unit"
                              value={it.unit}
                              aria-label={t('cp.nutritionUnit')}
                              onChange={(e) =>
                                patchPlateItem(c.athlete.id, i, {
                                  unit: e.target.value as NutritionFoodItem['unit'],
                                })
                              }
                            >
                              {UNITS.map((u) => (
                                <option key={u} value={u}>
                                  {t(`n.unit.${u}`)}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="cp-plate-del"
                              onClick={() => removePlateItem(c.athlete.id, i)}
                            >
                              {t('cp.nutritionRemove')}
                            </button>
                          </div>
                          <BankPicker
                            onPick={(f) =>
                              patchPlateItem(c.athlete.id, i, {
                                label_fa: f.nameFA,
                                label_en: f.nameEN,
                                unit: f.unit,
                              })
                            }
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn-ghost cp-plate-add"
                        onClick={() => addPlateItem(c.athlete.id)}
                      >
                        + {t('cp.nutritionAdd')}
                      </button>

                      <h4 className="cp-plate-rx-title">💊 {t('cp.rxTitle')}</h4>
                      <p className="auth-hint">{t('cp.rxHint')}</p>
                      {draft.rx.map((p, i) => (
                        <div className="cp-plate-row" key={i}>
                          <input
                            className="cp-plate-input"
                            value={p.name_fa}
                            placeholder={t('cp.nutritionNameFa')}
                            onChange={(e) => patchRx(c.athlete.id, i, { name_fa: e.target.value })}
                          />
                          <input
                            className="cp-plate-input"
                            value={p.name_en}
                            placeholder={t('cp.nutritionNameEn')}
                            dir="ltr"
                            onChange={(e) => patchRx(c.athlete.id, i, { name_en: e.target.value })}
                          />
                          <button
                            type="button"
                            className="cp-plate-del"
                            onClick={() => removeRx(c.athlete.id, i)}
                          >
                            {t('cp.nutritionRemove')}
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn-ghost cp-plate-add"
                        onClick={() => addRx(c.athlete.id)}
                      >
                        + {t('cp.rxAdd')}
                      </button>

                      <button
                        type="button"
                        className="btn-primary cp-save"
                        disabled={plateSaving === c.athlete.id}
                        onClick={() => void savePlate(c)}
                      >
                        {plateSaving === c.athlete.id ? t('auth.pleaseWait') : t('cp.nutritionSave')}
                      </button>
                    </div>
                  );
                })()}
              {/* 🩺 بررسی مکمل — doctor-gated pipeline: AI draft → coach
                  review → doctor gate. No dosage fields anywhere. */}
              <SupplementReviewSection athleteId={c.athlete.id} coachId={auth.coach?.id ?? null} />
              {/* 🗑 حذف شاگرد — double-confirm destructive action. */}
              <button
                type="button"
                className={
                  deleteArmed[c.athlete.id] ? 'cp-delete-btn armed' : 'cp-delete-btn'
                }
                disabled={deletingId === c.athlete.id}
                onClick={() => void handleDeleteTrainee(c.athlete.id)}
              >
                {deletingId === c.athlete.id
                  ? t('auth.pleaseWait')
                  : deleteArmed[c.athlete.id]
                    ? t('cp.deleteTraineeConfirm')
                    : `🗑 ${t('cp.deleteTrainee')}`}
              </button>
            </div>
          ))
        )}
      </div>
      <Toast msg={toast} />
    </div>
  );
}
