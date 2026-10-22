/** Tab (a) — the finalized standalone questionnaire, rendered in an iframe.
 *
 *  Language: the standalone page follows the app's language. The initial
 *  `src` carries `?lang=` (captured once, so the iframe still loads exactly
 *  once and tab state survives), the page itself reads the persisted
 *  `km.lang.v1` localStorage key (same origin), and later toggles are
 *  pushed live via postMessage so an in-progress questionnaire is never
 *  reloaded.
 *
 *  Submit (§18.1): on «ساخت برنامه» the page stores the submission payload
 *  in same-origin localStorage and posts {type:'km-questionnaire-submit'}.
 *  A signed-in athlete's submission is persisted immediately (response +
 *  program + review_queue via the offline-queue engine); pre-signup (the
 *  onboarding funnel) the stored payload is flushed by the auth layer
 *  right after the profile rows exist. */
import { useEffect, useRef } from 'react';
import { useLang } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import {
  persistPendingSubmission,
  storePendingSubmission,
  type QuestionnaireSubmission,
} from '../lib/supabase';

export default function QuestionnaireTab() {
  const { t, lang } = useLang();
  const auth = useAuth();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const srcRef = useRef(`questionnaire.html?lang=${lang}`);
  const firstRef = useRef(true);
  // Latest athlete identity for the message listener (registered once).
  const athleteRef = useRef<{ id: string; coachId: string | null } | null>(null);
  athleteRef.current = auth.athlete
    ? { id: auth.athlete.id, coachId: auth.athlete.coach_id }
    : null;

  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return; // initial src already carries this language
    }
    frameRef.current?.contentWindow?.postMessage({ type: 'km-set-lang', lang }, '*');
  }, [lang]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; payload?: QuestionnaireSubmission } | null;
      if (!data || data.type !== 'km-questionnaire-submit' || !data.payload) return;
      // Trust boundary: the questionnaire page is bundled and same-origin;
      // submissions posted by a foreign window are forged and must not be
      // persisted under the athlete's identity (they would create a program
      // + review_queue row in the coach's queue).
      if (e.origin !== window.location.origin) return;
      // The page already wrote the same payload to localStorage; storing
      // again here keeps the parent correct even if that write was blocked.
      // Stamp the current athlete (if any) so a later login by someone
      // else can never flush this payload under their identity.
      const athlete = athleteRef.current;
      storePendingSubmission(data.payload, athlete?.id ?? null);
      if (athlete?.coachId) {
        void persistPendingSubmission({ athleteId: athlete.id, coachId: athlete.coachId }).catch(
          (err) => console.error('[questionnaire] submit persist failed (queued)', err)
        );
      }
      // No athlete yet (onboarding funnel): the payload stays stored and
      // signUpAthlete flushes it after the profile rows are written.
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      ref={frameRef}
      title={t('tab.questionnaire')}
      src={srcRef.current}
      className="questionnaire-frame-tab"
      allowFullScreen
    />
  );
}
