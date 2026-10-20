/** Tab (a) — the finalized standalone questionnaire, rendered in an iframe.
 *
 *  Language: the standalone page follows the app's language. The initial
 *  `src` carries `?lang=` (captured once, so the iframe still loads exactly
 *  once and tab state survives), the page itself reads the persisted
 *  `km.lang.v1` localStorage key (same origin), and later toggles are
 *  pushed live via postMessage so an in-progress questionnaire is never
 *  reloaded. */
import { useEffect, useRef } from 'react';
import { useLang } from '../lib/i18n';

export default function QuestionnaireTab() {
  const { t, lang } = useLang();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const srcRef = useRef(`questionnaire.html?lang=${lang}`);
  const firstRef = useRef(true);

  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return; // initial src already carries this language
    }
    frameRef.current?.contentWindow?.postMessage({ type: 'km-set-lang', lang }, '*');
  }, [lang]);

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
