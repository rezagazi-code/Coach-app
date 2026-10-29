/**
 * Tab (b) — the trainee's workout session, driven by their program.
 *
 * Core loop: ProgramStatusCard (top) shows where the athlete stands —
 * no program → questionnaire prompt; in_review/pending → awaiting coach;
 * approved/active → the coach-approved session below.
 *
 * - Approved program WITH exercises (from answers._program, persisted by
 *   public/questionnaire.html): day selector (when >1 day) + exercise
 *   cards, each with a «دیدن حرکت» demo-video pill (MuscleWiki allowlist)
 *   and tap-to-open the set logger for that exercise. Session/sets log
 *   with the REAL program_id + coach_id.
 * - in_review / pending: waiting card only, no demo.
 * - No program at all: the status prompt + the original demo session as
 *   fallback, now headed by an explicit «sample workout» banner (the bare
 *   demo used to read as the trainee's real session).
 */
import { useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { useLang } from '../lib/i18n';
import Toast from '../components/Toast';
import ProgramStatusCard, { useAthleteProgramStatus } from '../components/ProgramStatusCard';
import {
  enqueueWrite,
  enqueueLoggedSet,
  getCurrentAthleteId,
  localDateStr,
  newClientUuid,
  flushQueue,
  type Program,
  type ProgramExercise,
  type ProgramExerciseDay,
  type SessionDifficulty,
} from '../lib/supabase';

interface SetLog {
  weight: number; // kg
  reps: number;
  done: boolean;
  rpe: number | null;
}

const RPE_STEPS = [
  { v: 7, fa: '~۳', en: '~3' },
  { v: 8, fa: '~۲', en: '~2' },
  { v: 8.5, fa: '۱–۲', en: '1–2' },
  { v: 9, fa: '~۱', en: '~1' },
  { v: 9.5, fa: '۰–۱', en: '0–1' },
  { v: 10, fa: '۰', en: '0' },
];

/** Estimated 1RM (Epley) — PR = beating your previous best for THIS exercise. */
const epley = (weight: number, reps: number) => weight * (1 + reps / 30);

interface BestEffort {
  weight: number;
  reps: number;
}

const prStorageKey = (exercise: string) => `km.pr.v1.${exercise}`;

function loadBest(exercise: string): BestEffort | null {
  try {
    const raw = localStorage.getItem(prStorageKey(exercise));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BestEffort>;
    if (typeof parsed.weight === 'number' && typeof parsed.reps === 'number') {
      return { weight: parsed.weight, reps: parsed.reps };
    }
    return null;
  } catch {
    return null;
  }
}

function saveBest(exercise: string, best: BestEffort) {
  try {
    localStorage.setItem(prStorageKey(exercise), JSON.stringify(best));
  } catch {
    /* storage unavailable — PR still shown this session */
  }
}

// Per-exercise-day workout persistence (program mode only — the demo
// logger must stay in-memory only, see LoggerSpec.demo).
// Without this, leaving an exercise logger (back to the list) and
// re-opening it started a FRESH session: new session id, all sets
// undone, and re-logging created a second workout_sessions row plus
// duplicate logged_sets (set UUIDs derive from the session id) in the
// coach's records. The stored state resumes the same session id and
// the same done-sets, so a re-open can only continue, never duplicate.
const WORKOUT_LOCAL_PREFIX = 'km.workout.v1.';

interface StoredWorkoutState {
  date: string;
  sessionId: string;
  startedAtMs: number;
  sets: SetLog[];
}

function workoutStateKey(persistKey: string): string {
  return `${WORKOUT_LOCAL_PREFIX}${persistKey}`;
}

function loadWorkoutState(persistKey: string, count: number): StoredWorkoutState | null {
  try {
    const raw = localStorage.getItem(workoutStateKey(persistKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredWorkoutState>;
    if (parsed.date !== localDateStr()) return null;
    if (typeof parsed.sessionId !== 'string' || !parsed.sessionId) return null;
    if (typeof parsed.startedAtMs !== 'number') return null;
    if (!Array.isArray(parsed.sets) || parsed.sets.length !== count) return null;
    const sets: SetLog[] = [];
    for (const s of parsed.sets) {
      const o = s as Partial<SetLog>;
      if (typeof o.weight !== 'number' || typeof o.reps !== 'number' || typeof o.done !== 'boolean') {
        return null;
      }
      sets.push({ weight: o.weight, reps: o.reps, done: o.done, rpe: typeof o.rpe === 'number' ? o.rpe : null });
    }
    return { date: parsed.date, sessionId: parsed.sessionId, startedAtMs: parsed.startedAtMs, sets };
  } catch {
    return null;
  }
}

function saveWorkoutState(persistKey: string, state: StoredWorkoutState): void {
  try {
    localStorage.setItem(workoutStateKey(persistKey), JSON.stringify(state));
    // Prune other days' in-progress sessions: a new day starts a fresh
    // session by design (the key carries no date), so yesterday's state
    // is dead weight, not resumable data.
    const ownKey = workoutStateKey(persistKey);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(WORKOUT_LOCAL_PREFIX) || k === ownKey) continue;
      try {
        const other = JSON.parse(localStorage.getItem(k) ?? '') as Partial<StoredWorkoutState>;
        if (other?.date !== localDateStr()) localStorage.removeItem(k);
      } catch {
        localStorage.removeItem(k);
      }
    }
  } catch {
    /* storage unavailable — session still works this mount */
  }
}

/**
 * Parse a sets spec like "3 sets × 8–10 reps" (setsEn from the
 * questionnaire) into a set count + rep target. Falls back to 3×10 when
 * the text doesn't match (e.g. "Daily").
 */
function parseSetsSpec(setsEn: string): { count: number; reps: number } {
  const m = /(\d+)\s*sets?\s*[×x]\s*(\d+)(?:\s*[–—-]\s*(\d+))?/i.exec(setsEn || '');
  if (!m) return { count: 3, reps: 10 };
  const count = Math.min(8, Math.max(1, parseInt(m[1], 10)));
  const lo = parseInt(m[2], 10);
  const hi = m[3] ? parseInt(m[3], 10) : lo;
  return { count, reps: Math.max(1, Math.round((lo + hi) / 2)) };
}

/** Demo-video links: same allowlist + open path as the questionnaire tab. */
function openDemoVideo(url: string) {
  if (!/^https:\/\/musclewiki\.com\//.test(url)) return;
  if (Capacitor.isNativePlatform()) {
    void Browser.open({ url }).catch((err) => console.error('[workout] browser open failed', err));
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

// ---------------------------------------------------------------------------
// SetLogger — the session logger, parameterized by exercise.
// The demo session below feeds it the original hardcoded spec, unchanged.
// ---------------------------------------------------------------------------

interface LoggerSpec {
  exerciseKey: string; // PR-storage namespace + logged exercise identity
  title: string; // exercise display name (already localized)
  sessionTitle: string; // h2 above the card
  video: string; // demo-video URL or ""
  initialSets: SetLog[];
  preLogged: number; // leading sets that start done (demo fixture)
  prFallback: BestEffort;
  programId: string | null;
  coachId: string | null;
  onBack: (() => void) | null; // program mode: back to the exercise list
  /**
   * Resume key for program mode (`<programId>:<day>:<exerciseId>`).
   * Absent for the demo logger: demo sessions must never persist.
   */
  persistKey?: string | null;
  /**
   * Demo (no-program fallback) logger: the athlete tries the logger UI
   * before they have a program. It must NEVER write to the sync queue:
   * the fixture sets (30×12, 32.5×10 pre-logged) are not real workouts,
   * and logging them would plant phantom sessions/sets — under the fake
   * exercise id 'w.exercise' — in the coach's records the moment the
   * queue flushes. Demo logging stays in-memory only.
   */
  demo?: boolean;
}

function SetLogger({ spec }: { spec: LoggerSpec }) {
  const { t, num, lang } = useLang();
  // Resume state, read once per mount (see the persistence note above):
  // a re-opened exercise continues its stored session instead of
  // starting a duplicate one. Demo loggers never carry a persistKey.
  const storedOnce = useRef<{ tried: boolean; state: StoredWorkoutState | null }>({
    tried: false,
    state: null,
  });
  if (!storedOnce.current.tried) {
    storedOnce.current = {
      tried: true,
      state: spec.persistKey ? loadWorkoutState(spec.persistKey, spec.initialSets.length) : null,
    };
  }
  const stored = storedOnce.current.state;
  const [sets, setSets] = useState<SetLog[]>(() => stored?.sets ?? spec.initialSets);
  const [active, setActive] = useState(() => {
    if (stored) {
      const idx = stored.sets.findIndex((s) => !s.done);
      return idx === -1 ? 0 : idx;
    }
    return spec.preLogged;
  });
  const [rpe, setRpe] = useState<number | null>(null);
  const [showPR, setShowPR] = useState(false);
  const [feedback, setFeedback] = useState<'easy' | 'ok' | 'hard' | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Offline-first session identity: one client-generated id per app session,
  // used as the workout_sessions row's id AND client_uuid (upsert-safe).
  // The ref also remembers the session start so the completion write can
  // compute duration_min without re-sending started_at (which would
  // clobber the true start on the conflict→UPDATE path). A resumed
  // logger reuses the stored session id + start, so the completion
  // upsert collapses onto the original row instead of adding a second.
  const sessionIdRef = useRef<{ id: string; startedAtMs: number } | null>(
    stored ? { id: stored.sessionId, startedAtMs: stored.startedAtMs } : null
  );

  const persist = (nextSets: SetLog[], sid: string, startedAtMs: number) => {
    if (!spec.persistKey) return;
    saveWorkoutState(spec.persistKey, { date: localDateStr(), sessionId: sid, startedAtMs, sets: nextSets });
  };
  // The session's calendar day is the DEVICE's local day — the same
  // convention as NutritionTab's log_date (localDateStr). The old
  // toISOString() slice is UTC, so a session logged 00:00–03:30 Tehran
  // was dated the previous day and the coach's date-ordered session list
  // misplaced it; started_at already carries the true UTC timestamp.
  const todayISO = () => localDateStr();

  const ensureSession = (): string => {
    const existing = sessionIdRef.current;
    if (existing) return existing.id;
    // Demo logger: local-only session id, nothing enqueued (see spec.demo).
    if (spec.demo) {
      const id = newClientUuid();
      sessionIdRef.current = { id, startedAtMs: Date.parse(new Date().toISOString()) };
      return id;
    }
    const id = newClientUuid();
    const startedAt = new Date().toISOString();
    sessionIdRef.current = { id, startedAtMs: Date.parse(startedAt) };
    enqueueWrite('workout_sessions', {
      id,
      athlete_id: getCurrentAthleteId(),
      coach_id: spec.coachId,
      program_id: spec.programId,
      date: todayISO(),
      started_at: startedAt,
      completed_at: null,
      duration_min: null,
      difficulty: null,
      avg_rpe: null,
      notes: '',
      client_uuid: id,
    });
    // Pre-logged fixture sets render as done in the UI — persist them
    // through the queue too, or the server would hold only the sets logged
    // during this visit while the coach sees N done sets. Deterministic
    // set UUIDs keep this idempotent across retries.
    for (let i = 0; i < spec.preLogged; i++) {
      const s = spec.initialSets[i];
      if (!s || !s.done) continue;
      enqueueLoggedSet(id, {
        set_number: i + 1,
        weight_kg: s.weight,
        reps: s.reps,
        rpe: s.rpe,
      });
    }
    return id;
  };

  const activeSet = sets[active];
  const allDone = sets.every((s) => s.done);

  const flash = (msg: string) => {
    setToast(null);
    requestAnimationFrame(() => setToast(msg));
    window.setTimeout(() => setToast(null), 2200);
  };

  const bump = (key: 'weight' | 'reps', delta: number) => {
    setSets((prev) => {
      const next = [...prev];
      const cur = next[active];
      if (!cur || cur.done) return prev;
      const v = key === 'weight' ? cur.weight + delta : cur.reps + delta;
      const clamped =
        key === 'weight' ? Math.max(2.5, Math.min(120, Math.round(v * 2) / 2)) : Math.max(1, Math.min(40, v));
      next[active] = { ...cur, [key]: clamped };
      return next;
    });
  };

  const logSet = () => {
    if (!activeSet || activeSet.done || rpe === null) return;
    // PR detection (per supabase-training-log.sql design): compare against
    // the athlete's previous best for this same exercise.
    const prevBest = loadBest(spec.exerciseKey) ?? spec.prFallback;
    const isPR = epley(activeSet.weight, activeSet.reps) > epley(prevBest.weight, prevBest.reps) + 1e-9;
    // Demo logger stays in-memory only (see LoggerSpec.demo): a demo PR
    // must not persist — the banner promises nothing is saved, and the
    // persisted demo best would otherwise sit in localStorage.
    if (isPR && !spec.demo) {
      saveBest(spec.exerciseKey, { weight: activeSet.weight, reps: activeSet.reps });
    }
    // Computed from the render closure (same as the advance search
    // below): the persisted copy must match exactly what the UI shows,
    // so a re-open restores these done-sets instead of re-logging them
    // under a fresh session id.
    const nextSets = sets.map((s, i) => (i === active ? { ...s, done: true, rpe } : s));
    setSets(nextSets);
    setRpe(null);
    flash(t('w.logged'));
    if (isPR) setShowPR(true);
    // Offline queue: session logs persist locally and sync (idempotent)
    // whenever the Supabase project exists and the athlete is known.
    // Demo logger skips the queue entirely (spec.demo) — ensureSession
    // already returned a local-only id, so no set is enqueued either.
    // The advance logic below still runs: the demo UI must behave.
    const sid = ensureSession();
    if (!spec.demo) {
    enqueueLoggedSet(sid, {
      exercise_id: spec.exerciseKey,
      set_number: active + 1,
      weight_kg: activeSet.weight,
      reps: activeSet.reps,
      rpe,
      is_pr: isPR,
    });
    persist(nextSets, sid, sessionIdRef.current?.startedAtMs ?? Date.now());
    }
    // Advance to the next pending set — wrap to the FIRST pending set when
    // the logged set was the last pending one ahead (out-of-order logging).
    // Otherwise `active` stays on the just-logged (done) set and the whole
    // stepper/RPE/log block unmounts with sets still pending: a dead end.
    // (`sets` here is pre-update, so the active set still reads !done —
    // exclude it explicitly in the wrap search.)
    const nextIdx = sets.findIndex((s, i) => i > active && !s.done);
    const wrapIdx = sets.findIndex((s, i) => i !== active && !s.done);
    if (nextIdx !== -1) setActive(nextIdx);
    else if (wrapIdx !== -1) setActive(wrapIdx);
  };

  const finishWith = (fb: 'easy' | 'ok' | 'hard') => {
    setFeedback(fb);
    const sid = ensureSession();
    const startedAtMs = sessionIdRef.current?.startedAtMs ?? Date.now();
    const rpes = sets.filter((s) => s.done && s.rpe != null).map((s) => s.rpe as number);
    const avgRpe = rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null;
    const difficulty: SessionDifficulty = fb === 'easy' ? 'too_easy' : fb === 'hard' ? 'too_hard' : 'just_right';
    // Completion upserts on client_uuid — re-submits never duplicate.
    // started_at carries the TRUE start (kept in the ref): on the
    // conflict→UPDATE path this writes the identical value already there
    // (no clobber), and on the rare INSERT path — initial session entry
    // dropped after its retries while this entry still flushed — it beats
    // the now() column default, which would otherwise record started_at =
    // finish time alongside a duration computed from the real start.
    // Demo logger: feedback only, nothing enqueued (spec.demo).
    if (spec.demo) return;
    enqueueWrite('workout_sessions', {
      id: sid,
      athlete_id: getCurrentAthleteId(),
      coach_id: spec.coachId,
      program_id: spec.programId,
      date: todayISO(),
      started_at: new Date(startedAtMs).toISOString(),
      completed_at: new Date().toISOString(),
      duration_min: Math.max(1, Math.round((Date.now() - startedAtMs) / 60000)),
      difficulty,
      avg_rpe: avgRpe,
      notes: '',
      client_uuid: sid,
    });
    void flushQueue();
  };

  return (
    <>
      {spec.onBack && (
        <button type="button" className="neon-ghost back-btn" onClick={spec.onBack}>
          {t('w.backToProgram')}
        </button>
      )}
      <h2 className="section-title">{spec.sessionTitle}</h2>
      <div className="card neon-rise">
        <div className="exercise-name">{spec.title}</div>
        {spec.video && (
          <button
            type="button"
            className="ex-video-pill"
            onClick={() => openDemoVideo(spec.video)}
          >
            ▶ {t('w.watchDemo')}
          </button>
        )}

        {/* set cards */}
        <div className="set-grid">
          {sets.map((s, i) => (
            <button
              key={i}
              type="button"
              disabled={s.done}
              onClick={() => setActive(i)}
              className={`set-card${i === active && !allDone ? ' active' : ''}${s.done ? ' done' : ''}`}
            >
              <span className="set-num">
                {t('w.set')} {num(i + 1)}
              </span>
              {s.done ? (
                <>
                  <span className="set-check" aria-label={t('w.logged')}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 12.5l5 5L20 6.5" />
                    </svg>
                  </span>
                  <span className="set-val">
                    {num(s.weight)}×{num(s.reps)}
                  </span>
                  <span className="set-rpe">RPE {num(s.rpe ?? '')}</span>
                </>
              ) : (
                <span className="set-val pending">
                  {num(s.weight)}×{num(s.reps)}
                </span>
              )}
            </button>
          ))}
        </div>

        {!allDone && activeSet && !activeSet.done && (
          <>
            {/* steppers */}
            <div className="steppers">
              <div className="stepper">
                <span className="stepper-label">
                  {t('w.weight')} ({t('w.kg')})
                </span>
                <div className="stepper-row">
                  <button type="button" className="step-btn" onClick={() => bump('weight', -2.5)} aria-label="-2.5">
                    −
                  </button>
                  <span className="step-big">{num(activeSet.weight)}</span>
                  <button type="button" className="step-btn" onClick={() => bump('weight', 2.5)} aria-label="+2.5">
                    +
                  </button>
                </div>
              </div>
              <div className="stepper">
                <span className="stepper-label">{t('w.reps')}</span>
                <div className="stepper-row">
                  <button type="button" className="step-btn" onClick={() => bump('reps', -1)} aria-label="-1">
                    −
                  </button>
                  <span className="step-big">{num(activeSet.reps)}</span>
                  <button type="button" className="step-btn" onClick={() => bump('reps', 1)} aria-label="+1">
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* RPE */}
            <div className="rpe-block">
              <div className="rpe-head">
                <span>{t('w.rpe')}</span>
                <span className="rpe-sub">
                  {rpe !== null && (
                    <>
                      {t('w.rir')}: {lang === 'fa' ? RPE_STEPS.find((r) => r.v === rpe)?.fa : RPE_STEPS.find((r) => r.v === rpe)?.en}
                    </>
                  )}
                </span>
              </div>
              <div className="rpe-row">
                {RPE_STEPS.map((r) => (
                  <button
                    key={r.v}
                    type="button"
                    className={rpe === r.v ? 'rpe-btn active' : 'rpe-btn'}
                    onClick={() => setRpe(r.v)}
                  >
                    {num(r.v)}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="neon-btn neon-burst log-set-btn"
              disabled={rpe === null}
              onClick={logSet}
            >
              {t('w.logSet')}
            </button>
          </>
        )}
      </div>

      {/* end-of-session feedback */}
      {allDone && (
        <div className="card neon-rise">
          <div className="feedback-title">{t('w.sessionDone')}</div>
          {!feedback ? (
            <div className="feedback-row">
              <button type="button" className="neon-ghost feedback-btn" onClick={() => finishWith('easy')}>
                {t('w.easy')}
              </button>
              <button type="button" className="neon-btn neon-burst feedback-btn" onClick={() => finishWith('ok')}>
                {t('w.ok')}
              </button>
              <button type="button" className="neon-ghost feedback-btn" onClick={() => finishWith('hard')}>
                {t('w.hard')}
              </button>
            </div>
          ) : (
            <div className="feedback-done">{t('w.finalThanks')}</div>
          )}
        </div>
      )}

      {/* PR celebration overlay */}
      {showPR && (
        <div className="pr-overlay" onClick={() => setShowPR(false)}>
          <div className="pr-card" onClick={(e) => e.stopPropagation()}>
            <svg className="pr-bolt" width="56" height="56" viewBox="0 0 24 24" fill="#D4FF00" aria-hidden>
              <path d="M13 2L4.5 13.5H11L9.5 22 19 10h-6.5L13 2z" />
            </svg>
            <div className="pr-title">{t('w.pr')}</div>
            <div className="pr-sub">{t('w.prSub')}</div>
            <button type="button" className="neon-btn neon-burst pr-ok" onClick={() => setShowPR(false)}>
              {t('w.prOk')}
            </button>
          </div>
        </div>
      )}

      <Toast msg={toast} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Demo session — the original hardcoded workout, kept as the no-program
// fallback. Behavior unchanged.
// ---------------------------------------------------------------------------

function DemoWorkout() {
  const { t } = useLang();
  const spec: LoggerSpec = {
    exerciseKey: 'w.exercise',
    title: t('w.exercise'),
    sessionTitle: t('w.sessionTitle'),
    video: '',
    initialSets: [
      { weight: 30, reps: 12, done: true, rpe: 8 },
      { weight: 32.5, reps: 10, done: true, rpe: 9 },
      { weight: 35, reps: 8, done: false, rpe: null },
      { weight: 35, reps: 8, done: false, rpe: null },
    ],
    preLogged: 2,
    prFallback: { weight: 32.5, reps: 10 },
    programId: null,
    coachId: null,
    onBack: null,
    demo: true, // try-out only: never enqueues (see LoggerSpec.demo)
  };
  // The demo session used to render bare as «جلسه امروز: سینه و سرشانه»
  // under the no-program card — a trainee scrolling past the card read it
  // as their real session (live confusion on 2026-10-26). Label it
  // unmistakably as a sample before the logger renders.
  return (
    <>
      <div className="card status-card" role="note">
        <div className="status-sub">{t('w.demoBanner')}</div>
      </div>
      <SetLogger spec={spec} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Program session — the coach-approved program rendered from
// answers._program.exercises.
// ---------------------------------------------------------------------------

function ProgramSessionView({
  program,
  days,
}: {
  program: Program;
  days: ProgramExerciseDay[];
}) {
  const { t, num, lang } = useLang();
  const [dayIdx, setDayIdx] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const day = days[Math.min(dayIdx, days.length - 1)];
  const openEx: ProgramExercise | null = openId
    ? (day.exercises.find((e) => e.id === openId) ?? null)
    : null;

  if (openEx) {
    const { count, reps } = parseSetsSpec(openEx.setsEN);
    const prevBest = loadBest(`w.program.${openEx.id}`);
    const startWeight = prevBest ? prevBest.weight : 20;
    const spec: LoggerSpec = {
      exerciseKey: `w.program.${openEx.id}`,
      title: lang === 'fa' ? openEx.nameFA : openEx.nameEN,
      sessionTitle: t('w.todaySession'),
      video: openEx.video,
      initialSets: Array.from({ length: count }, () => ({
        weight: startWeight,
        reps,
        done: false,
        rpe: null,
      })),
      preLogged: 0,
      prFallback: { weight: startWeight, reps },
      programId: program.id,
      coachId: program.coach_id,
      onBack: () => setOpenId(null),
      // Day-scoped: the same exercise on another training day is a
      // different session, and a new program id starts fresh as well.
      persistKey: `${program.id}:${day.day}:${openEx.id}`,
    };
    return <SetLogger key={openEx.id} spec={spec} />;
  }

  return (
    <>
      <h2 className="section-title">{t('w.todaySession')}</h2>
      {days.length > 1 && (
        <div className="day-row" role="tablist" aria-label={t('w.todaySession')}>
          {days.map((d, i) => (
            <button
              key={d.day}
              type="button"
              role="tab"
              aria-selected={i === dayIdx}
              className={i === dayIdx ? 'day-btn active' : 'day-btn'}
              onClick={() => {
                setDayIdx(i);
                setOpenId(null);
              }}
            >
              {t('w.day')} {num(d.day)}
            </button>
          ))}
        </div>
      )}
      <div className="program-ex-list">
        {day.exercises.map((ex) => {
          const name = lang === 'fa' ? ex.nameFA : ex.nameEN;
          const sets = lang === 'fa' ? ex.setsFA : ex.setsEN;
          const note = lang === 'fa' ? ex.noteFA : ex.noteEN;
          return (
            <div
              key={ex.id}
              className="card program-ex-card"
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(ex.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenId(ex.id);
                }
              }}
            >
              <div className="program-ex-name">{name}</div>
              <div className="program-ex-sets">{sets}</div>
              {note && <div className="program-ex-note">{note}</div>}
              <div className="program-ex-foot">
                {ex.video ? (
                  <button
                    type="button"
                    className="ex-video-pill"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDemoVideo(ex.video);
                    }}
                  >
                    ▶ {t('w.watchDemo')}
                  </button>
                ) : (
                  <span />
                )}
                <span className="program-ex-go">{t('w.startWorkout')}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab root — status card on top, then the view matching the program state.
// ---------------------------------------------------------------------------

export default function WorkoutTab() {
  const state = useAthleteProgramStatus();
  return (
    <div className="tab-pad">
      <ProgramStatusCard state={state} />
      {state.kind === 'ready' && (
        <ProgramSessionView program={state.program} days={state.days} />
      )}
      {state.kind === 'none' && <DemoWorkout />}
    </div>
  );
}
