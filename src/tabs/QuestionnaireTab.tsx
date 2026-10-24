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
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
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
      const data = e.data as { type?: string; payload?: QuestionnaireSubmission; url?: string } | null;
      // Demo-video links: the questionnaire iframe routes target=_blank taps
      // here because the Android WebView silently drops them (Capacitor has
      // no onCreateWindow). Open in the system browser via @capacitor/browser.
      if (data && data.type === 'km-open-url') {
        if (e.origin !== window.location.origin) return;
        const url = typeof data.url === 'string' ? data.url : '';
        // Allowlist: only the bundled MuscleWiki demo-video links may open.
        if (!/^https:\/\/musclewiki\.com\//.test(url)) return;
        if (Capacitor.isNativePlatform()) {
          void Browser.open({ url }).catch((err) =>
            console.error('[questionnaire] browser open failed', err)
          );
        } else {
          window.open(url, '_blank', 'noopener');
        }
        return;
      }
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
      // The workout tab's program-status hook runs once per mount — tell it
      // (and any other same-document listener) to re-read the status now,
      // so a submit in this session updates the card without an app restart.
      window.dispatchEvent(new CustomEvent('km-submission-stored'));
      if (athlete?.coachId) {
        // The status card refreshed on the event above — but at that point
        // the program row isn't in the DB yet (the offline queue flushes
        // asynchronously). For coach tracks this is invisible (pending and
        // in_review render identically), but an aionly program becomes
        // 'active' instantly and must appear right away — so re-fire the
        // event once the queue has actually synced, or the card stays on
        // "pending" forever until an app restart.
        void persistPendingSubmission({ athleteId: athlete.id, coachId: athlete.coachId })
          .then((result) => {
            if (result === 'synced') {
              window.dispatchEvent(new CustomEvent('km-submission-stored'));
            }
          })
          .catch((err) => console.error('[questionnaire] submit persist failed (queued)', err));
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
