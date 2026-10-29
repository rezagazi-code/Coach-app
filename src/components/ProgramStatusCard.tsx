/**
 * Athlete-side program status card (top of the workout tab).
 *
 * The trainee core loop: questionnaire → program (in_review) → coach
 * approves → trainee trains from the approved program. Until now the
 * trainee saw NOTHING of this pipeline — this card closes that gap:
 *   none              → prompt to fill the questionnaire
 *   pending/in_review → «sent to coach — awaiting review» (pending = the
 *                       submission exists locally but hasn't synced yet:
 *                       offline / demo mode)
 *   approved/active   → «approved by {coach}» (+ exercise list when the
 *                       persisted answers carry it)
 */
import { useEffect, useRef, useState } from 'react';
import { useLang } from '../lib/i18n';
import {
  getAthleteActiveProgram,
  getAthleteLatestProgram,
  getCurrentAthleteId,
  questionnaireResponseForReview,
  readPendingSubmission,
  SupabaseNotConfiguredError,
  type Program,
  type ProgramExerciseDay,
} from '../lib/supabase';

export type ProgramState =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'in_review'; program: Program; coachName: string | null }
  | { kind: 'ready'; program: Program; coachName: string | null; days: ProgramExerciseDay[] }
  | { kind: 'ready-noexercises'; program: Program; coachName: string | null };

function validDays(v: unknown): ProgramExerciseDay[] | null {
  if (!Array.isArray(v)) return null;
  const days = (v as Array<Record<string, unknown>>).filter(
    (d) => d && typeof d === 'object' && typeof d.day === 'number' && Array.isArray(d.exercises)
  );
  return days.length ? (days as unknown as ProgramExerciseDay[]) : null;
}

/** True when a locally stored submission belongs to this athlete (or to nobody yet). */
function hasOwnPendingSubmission(athleteId: string | null): boolean {
  const p = readPendingSubmission();
  if (!p) return false;
  const stamped = p.athleteId ?? null;
  // A payload stamped for a DIFFERENT athlete is never ours (shared device).
  if (stamped && stamped !== athleteId) return false;
  return true;
}

export function useAthleteProgramStatus(): ProgramState {
  const [state, setState] = useState<ProgramState>({ kind: 'loading' });
  const seqRef = useRef(0);
  // Last resolved non-loading state. A failed refresh must not blank it:
  // the same trap class as the supplement-review (afea0ca) and nutrition
  // (5eb96c4) fixes — a transient read failure on a foreground refresh
  // used to flip a trainee with an approved program to 'none', swapping
  // their real session for the demo workout until the next refresh.
  // Only a trainable state is worth keeping: 'none'/'pending'/'in_review'
  // hide no session, and fresh server data (e.g. a new in_review row)
  // must still replace them.
  const lastGoodRef = useRef<ProgramState | null>(null);
  useEffect(() => {
    let alive = true;
    // Re-runnable: the tab host keeps WorkoutTab mounted while the athlete
    // submits in the questionnaire tab, so the status must refresh on the
    // in-session submit event — not only on mount.
    //
    // Same trap class as the CoachPanel queue fixes (c37a5dc/83414b8):
    // refresh() fires from THREE sources that routinely burst together —
    // km-submission-stored (dispatched twice per submit: once immediately
    // and once after the queue syncs), km-queue-flushed, and foreground
    // (visibilitychange + focus) — and each refresh runs several
    // sequential reads. Without a sequence check, an older refresh that
    // started before the sync can resolve after the newer one and
    // overwrite the fresh status with its pre-sync state, leaving the
    // trainee stuck on «sent to coach» for an already-active program
    // until the next foreground event. The `alive` flag alone cannot
    // catch this: both refreshes are alive.
    const refresh = () => {
      const seq = ++seqRef.current;
      const set = (s: ProgramState) => {
        if (alive && seq === seqRef.current) {
          setState(s);
          if (s.kind !== 'loading') lastGoodRef.current = s;
        }
      };
      // True when the trainee currently trains from a program that a
      // failed refresh must not hide (see lastGoodRef above).
      const keepTrainableOnFailure = () =>
        lastGoodRef.current?.kind === 'ready' || lastGoodRef.current?.kind === 'ready-noexercises';
      (async () => {
      const athleteId = getCurrentAthleteId();
      const fallback = (): ProgramState =>
        hasOwnPendingSubmission(athleteId) ? { kind: 'pending' } : { kind: 'none' };
      try {
        if (!athleteId) {
          set(fallback());
          return;
        }
        const latest = await getAthleteLatestProgram(athleteId);
        if (!latest) {
          set(fallback());
          return;
        }
        const { program, coachName } = latest;
        if (program.status === 'approved' || program.status === 'active') {
          // Exercises belong to THIS program's submission, not simply the
          // newest response: a later red-flag-blocked resubmission writes a
          // response but no program, and its answers carry no usable
          // _program — reading «latest» here would drop the approved
          // session's exercise list for ready-noexercises.
          const resp = await questionnaireResponseForReview(athleteId, program.created_at);
          const days = validDays(
            (resp?.answers as Record<string, unknown> | undefined)?._program &&
              ((resp?.answers as Record<string, unknown>)._program as Record<string, unknown>).exercises
          );
          set(
            days
              ? { kind: 'ready', program, coachName, days }
              : { kind: 'ready-noexercises', program, coachName }
          );
          return;
        }
        // in_review / draft / archived — the newest program is not
        // trainable, but an older APPROVED program may still be live.
        // A fresh resubmission awaiting the coach (in_review) must not
        // hide it either: before this, re-doing the questionnaire left
        // the trainee with only the demo workout until the coach
        // decided — the same trap class as the rejected-resubmission fix
        // below, which covered draft/archived but not in_review. Only
        // when no approved program exists is a fresh questionnaire (or
        // the awaiting-review card) the way back.
        try {
          const active = await getAthleteActiveProgram(athleteId);
          if (active) {
            const resp = await questionnaireResponseForReview(athleteId, active.program.created_at);
            const days = validDays(
              (resp?.answers as Record<string, unknown> | undefined)?._program &&
                ((resp?.answers as Record<string, unknown>)._program as Record<string, unknown>).exercises
            );
            set(
              days
                ? { kind: 'ready', program: active.program, coachName: active.coachName, days }
                : { kind: 'ready-noexercises', program: active.program, coachName: active.coachName }
            );
            return;
          }
        } catch {
          // The active-program read failed transiently: the newest row
          // is draft/archived/in_review, but a trainable program may
          // still be live — falling through would hide it behind the
          // awaiting-review card (or 'none'). Keep it; the next
          // foreground/event refresh retries the read.
          if (keepTrainableOnFailure()) return;
          /* else fall through to the local signal below */
        }
        if (program.status === 'in_review') {
          set({ kind: 'in_review', program, coachName });
          return;
        }
        set(fallback());
      } catch (e) {
        // Unconfigured backend (demo mode) or a transient read failure:
        // never strand the UI — the local submission signal decides,
        // EXCEPT when a trainable program is already on screen: a failed
        // refresh must not blank it to 'none' (demo workout) until the
        // next refresh proves it gone. First-load failures (no resolved
        // state yet) still fall back to the local signal as before.
        if (alive) {
          if (!(e instanceof SupabaseNotConfiguredError)) {
            console.warn('[program-status] read failed, using local signal', e);
          }
          if (!keepTrainableOnFailure()) set(fallback());
        }
      }
    })();
    };
    refresh();
    window.addEventListener('km-submission-stored', refresh);
    // Background sync (offline → online): the queue drains without the
    // submit tab's re-dispatch, so a synced aionly program must refresh here.
    window.addEventListener('km-queue-flushed', refresh);
    // Same trap class as the 0.2.29 doctor-handoff fix: all tabs stay
    // mounted (display:none), so this effect runs once per app start — a
    // coach approval arriving while the trainee's app is open would
    // otherwise never appear until restart, leaving the trainee stuck on
    // «sent to coach» with the approved program (and its exercise list)
    // invisible. Re-check whenever the app returns to the foreground:
    // that is the realistic approval-arrival moment (coach approves,
    // tells the trainee, the trainee opens/foregrounds the app).
    const onForeground = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    return () => {
      alive = false;
      window.removeEventListener('km-submission-stored', refresh);
      window.removeEventListener('km-queue-flushed', refresh);
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
    };
  }, []);
  return state;
}

export default function ProgramStatusCard({ state }: { state: ProgramState }) {
  const { t } = useLang();
  if (state.kind === 'loading') {
    return (
      <div className="card status-card" aria-busy="true">
        <div className="status-shimmer" />
      </div>
    );
  }
  if (state.kind === 'none') {
    return (
      <div className="card status-card">
        <div className="status-title">{t('w.noProgramTitle')}</div>
        <div className="status-sub">{t('w.noProgramBody')}</div>
      </div>
    );
  }
  if (state.kind === 'pending' || state.kind === 'in_review') {
    return (
      <div className="card status-card">
        <div className="status-title">📤 {t('w.programSent')}</div>
        <div className="status-sub">{t('w.programSentSub')}</div>
      </div>
    );
  }
  const coachLine = state.coachName ? `${t('w.approvedBy')} ${state.coachName}` : t('w.approvedNoName');
  return (
    <div className="card status-card approved">
      <div className="status-title">✅ {coachLine}</div>
      {state.kind === 'ready-noexercises' && <div className="status-sub">{t('w.noExercisesNote')}</div>}
    </div>
  );
}
