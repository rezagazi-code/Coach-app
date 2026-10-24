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
import { useState } from 'react';
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

  const demo = !isSupabaseConfigured;

  const load = async () => {
    if (loaded || loading) return;
    setLoading(true);
    try {
      if (demo) {
        const local = readLocalSuppReviews()[athleteId] ?? null;
        setReview(local);
        setNote(local?.coach_note ?? '');
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
        const [resp, rev] = await Promise.all([
          getAthleteLatestResponse(athleteId).catch(() => null),
          getSupplementReview(athleteId).catch(() => null),
        ]);
        setResponse(resp);
        setReview(rev);
        setNote(rev?.coach_note ?? '');
      }
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
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
      if (demo) {
        setReview(writeLocal());
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
          setReview(row);
        } catch {
          setReview(writeLocal());
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const reopen = () => setReview((prev) => (prev ? { ...prev, status: 'pending' as const } : prev));

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
              <button type="button" className="btn-ghost cp-plate-add" onClick={reopen}>
                {t('s.reopen')}
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
                  onChange={(e) => setNote(e.target.value)}
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
