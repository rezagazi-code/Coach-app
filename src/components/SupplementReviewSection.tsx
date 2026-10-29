/**
 * SupplementReviewSection — coach-side «🩺 بررسی مکمل» in the athlete card.
 *
 * Pipeline (Reza 2026-10-24): AI draft → coach review/approve → DOCTOR gate.
 * - The draft is rule-built live from the athlete's screening answers
 *   (supplementDraft.ts). Candidate language only — never "needs X".
 * - The coach can edit a note for the doctor, then Approve or Reject.
 *   NO dosage inputs exist anywhere on this surface.
 * - Approval does NOT expose anything to the trainee directly; it unlocks
 *   the «گزارش برای پزشک» handoff card on the trainee's nutrition tab.
 * - Demo/offline mode: review state in localStorage (km.suppreview.v1).
 */
import { useEffect, useRef, useState } from 'react';
import { useLang } from '../lib/i18n';
import {
  getAthleteLatestResponse,
  getSupplementReview,
  isSupabaseConfigured,
  readLocalSuppReviews,
  saveSupplementReview,
  writeLocalSuppReviews,
  type QuestionnaireResponse,
  type SupplementReview,
} from '../lib/supabase';
import { buildSupplementDraft, type SupplementDraft } from '../lib/supplementDraft';

const DEMO_ANSWERS: Record<string, unknown> = {
  suppUse: 'no',
  suppList: '',
  medsUse: 'no',
  medsList: '',
  dietType: 'vegetarian',
  sun: 'low',
  diagDef: 'no',
  diagList: '',
  fatigue: 'no',
};

function DraftView({ draft }: { draft: SupplementDraft }) {
  const { t, lang } = useLang();
  return (
    <div className="supp-draft">
      <h4 className="supp-sub">{t('s.draftTitle')}</h4>
      {draft.candidates.length > 0 ? (
        <>
          <p className="supp-sec-title">{t('s.candidatesTitle')}</p>
          <ul className="supp-list">
            {draft.candidates.map((c, i) => (
              <li key={i} className="supp-candidate">
                <span className="supp-chip">⚠ {lang === 'fa' ? c.itemFA : c.itemEN}</span>
                <span className="supp-why">{lang === 'fa' ? c.rationaleFA : c.rationaleEN}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="cp-empty">{t('s.noData')}</p>
      )}
      {draft.doctorQuestions.length > 0 && (
        <>
          <p className="supp-sec-title">{t('s.doctorQuestionsTitle')}</p>
          <ul className="supp-list">
            {draft.doctorQuestions.map((q, i) => (
              <li key={i}>{lang === 'fa' ? q.fa : q.en}</li>
            ))}
          </ul>
        </>
      )}
      {draft.interactionCautions.length > 0 && (
        <>
          <p className="supp-sec-title">{t('s.cautionsTitle')}</p>
          <ul className="supp-list">
            {draft.interactionCautions.map((c, i) => (
              <li key={i} className="supp-caution">
                {lang === 'fa' ? c.fa : c.en}
              </li>
            ))}
          </ul>
        </>
      )}
      {draft.currentSupplements && (
        <p className="supp-note-line">
          {lang === 'fa' ? draft.currentSupplements.fa : draft.currentSupplements.en}
        </p>
      )}
      <p className="supp-disclaimer" role="note">
        ⚠ {lang === 'fa' ? draft.disclaimer.fa : draft.disclaimer.en}
      </p>
    </div>
  );
}

export default function SupplementReviewSection({
  athleteId,
  coachId,
}: {
  athleteId: string;
  coachId: string | null;
}) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<QuestionnaireResponse | null>(null);
  const [review, setReview] = useState<SupplementReview | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // A note the coach typed but has not saved yet must survive a reload
  // for the SAME response; without this, re-expanding would wipe it with
  // the saved note. It must NOT survive a response change (see
  // noteResponseRef): text typed for superseded answers is stale for the
  // fresh draft, same as the previous decision's saved note.
  const noteDirtyRef = useRef(false);
  // The response the current note text belongs to. A note belongs to
  // exactly one screening: when the latest response changes (trainee
  // resubmission), the fresh decision starts with an empty note — the
  // previous decision's saved note, and any text typed for the old draft,
  // must not ride the new decision if the coach approves without editing.
  const noteResponseRef = useRef<string | null>(null);
  // Stale-load guard (same trap class as the CoachPanel queue fix): a
  // foreground silent load whose fetch started BEFORE the coach's decision
  // must not overwrite the decided review when it resolves late — without
  // this, an approval visibly vanished back to the draft view until the
  // next expand, even though the server held the approved row.
  const loadSeqRef = useRef(0);

  const demo = !isSupabaseConfigured;

  const load = async (silent = false) => {
    // No `loading` guard here on purpose: one used to drop every
    // foreground re-check (and every re-expand) while a non-silent load
    // was in flight — so a trainee resubmission landing mid-load left
    // the coach deciding on the superseded draft, and a hung fetch wedged
    // the section stale until remount. Overlapping loads are already safe:
    // loadSeqRef skips the older run's writes, and decide()/reopen() bump
    // the sequence to invalidate in-flight pre-decision rows.
    const loadSeq = ++loadSeqRef.current;
    if (!silent) setLoading(true);
    try {
      if (demo) {
        const local = readLocalSuppReviews()[athleteId] ?? null;
        setReview(local);
        if (!noteDirtyRef.current) setNote(local?.coach_note ?? '');
        setResponse({
          id: `demo-response-${athleteId}`,
          athlete_id: athleteId,
          coach_id: coachId,
          track: 'gym',
          answers: DEMO_ANSWERS,
          flags: {},
          client_uuid: null,
          created_at: new Date().toISOString(),
        } as QuestionnaireResponse);
      } else {
        // A failed response fetch must be distinguishable from "no
        // response yet": the old catch-to-null collapsed them, so a
        // transient failure blanked the section with «no data» — hiding
        // a loaded decision and its draft until the next expand — the
        // same failure-blanking class as the CoachPanel plate fix.
        let respFailed = false;
        const [resp, rev] = await Promise.all([
          getAthleteLatestResponse(athleteId).catch(() => {
            respFailed = true;
            return null;
          }),
          getSupplementReview(athleteId)
            .catch(() => null)
            // Fallback: a decision saved locally (migration not run / offline)
            .then((r) => r ?? readLocalSuppReviews()[athleteId] ?? null),
        ]);
        // Stale load: a newer load started, or the coach decided while
        // this fetch was in flight — never overwrite the newer state.
        if (loadSeq !== loadSeqRef.current) return;
        // Failed fetch preserves the last good state (response, review,
        // and note) instead of blanking it; the next foreground re-check
        // retries. A first load with no prior state still shows «no
        // data», exactly as before.
        if (respFailed) return;
        setResponse(resp);
        setReview(rev);
        // A decision only stands for its own response (decidedForCurrent
        // below): when the latest response is NEWER than the loaded review,
        // the review's saved note belongs to the superseded decision, not
        // to this draft. Clearing the dirty flag on decide() (1c2a830) did
        // not fix that ride: with dirty cleared, this load restored the
        // old note verbatim; with dirty set, the stale note state survived
        // instead — both paths pre-filled the fresh decision with it.
        // So a response change resets the note outright, typed text
        // included (it described the old answers). Same-response reloads
        // keep the existing dirty-guard behaviour.
        const noteForCurrent = !resp || !rev || rev.response_id === resp.id;
        if (!noteForCurrent && resp) {
          if (noteResponseRef.current !== resp.id) {
            setNote('');
            noteDirtyRef.current = false;
          }
          noteResponseRef.current = resp.id;
        } else {
          // The mismatch branch above only fires when a review row exists
          // for the old response — with NO review row yet (rev null), a
          // resubmission left a dirty note typed for the superseded
          // answers standing, and it then rode the fresh decision if the
          // coach approved without editing (the ca29f6a trap, one branch
          // short). A note belongs to exactly one response: when the
          // response changed under a dirty note, clear it outright; the
          // restore below then pulls the current decision's saved note
          // (or '' when there is none), never the stale typed text.
          if (resp && noteResponseRef.current && noteResponseRef.current !== resp.id) {
            setNote('');
            noteDirtyRef.current = false;
          }
          if (!noteDirtyRef.current) setNote(rev?.coach_note ?? '');
          if (resp) noteResponseRef.current = resp.id;
        }
      }
    } finally {
      if (!silent) setLoading(false);
      setLoaded(true);
    }
  };

  // Call the LATEST load() from listeners: the foreground effect below
  // subscribes once per open, but load() is re-created every render — a
  // listener holding the first closure would read stale refs (e.g. the
  // unsaved-note guard) and miss later re-checks.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (!open) return;
    // Same trap class as the queue/expand fixes: the section stays mounted
    // while expanded, so a trainee resubmission arriving while the coach's
    // app is backgrounded would otherwise leave the coach deciding
    // (response_id and all) on a superseded draft. Re-check silently on
    // foreground — the unsaved-note guard in load() keeps typed text, and
    // the silent flag avoids flashing «please wait» over the open draft.
    const onForeground = () => {
      if (document.visibilityState === 'visible') void loadRef.current(true);
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    return () => {
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
    };
  }, [open ]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Reload on EVERY expand, not just the first: the old loaded-gate
    // froze the section at its first read, so a trainee resubmission after
    // that never surfaced — the coach could decide (response_id and all)
    // on a superseded draft while a fresh submission waited in the queue.
    if (next) void load();
  };

  const draft = buildSupplementDraft(response?.answers ?? null);
  // A decision only stands for the response it was made on; newer answers
  // supersede it and surface a fresh draft.
  const decidedForCurrent =
    review && response && review.response_id === response.id && review.status !== 'pending';
  const freshDraft = !decidedForCurrent && draft && draft.hasData;

  const decide = async (status: 'approved' | 'rejected') => {
    if (!draft || saving) return;
    // Invalidate any load in flight: its pre-decision row must not land
    // after this decision's setReview below.
    loadSeqRef.current++;
    setSaving(true);
    try {
      const snapshot = JSON.parse(JSON.stringify(draft)) as Record<string, unknown>;
      // Local decision write — used in demo mode and as a fallback when the
      // server table is unreachable (migration not run yet / offline), so the
      // coach's decision is never silently lost on this device.
      const writeLocal = (): SupplementReview => {
        const all = readLocalSuppReviews();
        const row: SupplementReview = {
          id: `local-${athleteId}`,
          athlete_id: athleteId,
          coach_id: coachId,
          response_id: response?.id ?? null,
          status,
          draft_snapshot: snapshot,
          coach_note: note.slice(0, 2000),
          decided_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };
        all[athleteId] = row;
        writeLocalSuppReviews(all);
        return row;
      };
      // The note is persisted by every path below (server row, or the
      // local fallback when the server write fails), so the dirty flag
      // must clear with it — mirroring CoachPanel's plateDirty rule.
      // Without this, the flag stayed set forever after the first
      // decision, and a later trainee resubmission re-opened the note
      // field pre-filled with the PREVIOUS decision's note, which then
      // rode the new decision if the coach approved without editing it.
      if (demo) {
        setReview(writeLocal());
        noteDirtyRef.current = false;
      } else {
        try {
          const row = await saveSupplementReview({
            athlete_id: athleteId,
            coach_id: coachId,
            response_id: response?.id ?? null,
            status,
            draft_snapshot: snapshot,
            coach_note: note,
          });
          // Mirror the server-confirmed row into the local fallback store:
          // without this, a later offline load reads the stale pre-decision
          // row (e.g. an approved handoff still showing after a reject, or
          // a fresh approval invisible) when the server fetch fails.
          const all = readLocalSuppReviews();
          all[athleteId] = row;
          writeLocalSuppReviews(all);
          setReview(row);
          noteDirtyRef.current = false;
        } catch {
          setReview(writeLocal());
          noteDirtyRef.current = false;
        }
      }
    } finally {
      setSaving(false);
    }
  };

  // «بازگشایی» reinstates review: the trainee's handoff card renders on
  // 'approved' rows only, so the revocation must PERSIST (server upsert,
  // local fallback) — an in-memory flip alone would leave the trainee
  // seeing the «گزارش برای پزشک» after reload while the coach believes
  // they un-approved it. The persisted 'pending' state brings the draft
  // back with Approve/Reject, exactly like a fresh decision flow.
  const reopen = async () => {
    if (!review || saving) return;
    // Same invalidation as decide(): an in-flight load's pre-reopen row
    // must not overwrite the pending state written below.
    loadSeqRef.current++;
    setSaving(true);
    try {
      const pending: SupplementReview = {
        ...review,
        status: 'pending' as const,
        decided_at: new Date().toISOString(),
      };
      const writeLocalPending = () => {
        const all = readLocalSuppReviews();
        all[athleteId] = pending;
        writeLocalSuppReviews(all);
        setReview(pending);
      };
      // Reopen keeps the saved note (it persists review.coach_note), so
      // clearing the dirty flag is safe here too: a later load restores
      // exactly that note instead of a stale typed one. (In the decided
      // view there is no textarea, so no unsaved typed note can exist.)
      if (demo) {
        writeLocalPending();
        noteDirtyRef.current = false;
      } else {
        try {
          const row = await saveSupplementReview({
            athlete_id: athleteId,
            coach_id: coachId,
            response_id: review.response_id,
            status: 'pending',
            draft_snapshot: review.draft_snapshot,
            coach_note: review.coach_note,
          });
          // Same mirror as decide(): a server-confirmed reopen must not
          // leave a stale 'approved' row in the offline fallback store.
          const all = readLocalSuppReviews();
          all[athleteId] = row;
          writeLocalSuppReviews(all);
          setReview(row);
          noteDirtyRef.current = false;
        } catch {
          writeLocalPending();
          noteDirtyRef.current = false;
        }
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="supp-section">
      <button
        type="button"
        className="btn-ghost cp-plate-toggle"
        aria-expanded={open}
        onClick={toggle}
      >
        {t('s.reviewTitle')}
      </button>
      {open && (
        <div className="cp-plate supp-panel">
          {loading && <p className="cp-empty">{t('auth.pleaseWait')}</p>}
          {loaded && !draft && <p className="cp-empty">{t('s.noData')}</p>}
          {loaded && draft && decidedForCurrent && review && (
            <div className="supp-decided">
              <p className={review.status === 'approved' ? 'supp-ok' : 'supp-no'}>
                {review.status === 'approved' ? t('s.approvedState') : t('s.rejectedState')}
              </p>
              {review.coach_note && <p className="supp-note-line">«{review.coach_note}»</p>}
              <button
                type="button"
                className="btn-ghost cp-plate-add"
                disabled={saving}
                onClick={() => void reopen()}
              >
                {saving ? t('s.saving') : t('s.reopen')}
              </button>
            </div>
          )}
          {loaded && freshDraft && (
            <>
              {review?.response_id && response && review.response_id !== response.id && (
                <p className="supp-fresh">{t('s.newAnswers')}</p>
              )}
              <DraftView draft={draft} />
              <label className="auth-field">
                <span className="auth-label">{t('s.coachNoteLabel')}</span>
                <textarea
                  className="cp-note"
                  rows={2}
                  value={note}
                  placeholder={t('s.coachNotePh')}
                  onChange={(e) => {
                    noteDirtyRef.current = true;
                    setNote(e.target.value);
                  }}
                />
              </label>
              <div className="supp-actions">
                <button
                  type="button"
                  className="neon-btn neon-burst"
                  disabled={saving}
                  onClick={() => void decide('approved')}
                >
                  {saving ? t('s.saving') : t('s.approve')}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={saving}
                  onClick={() => void decide('rejected')}
                >
                  {t('s.reject')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
