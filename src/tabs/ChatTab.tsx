/**
 * Tab (e) — coach chat. Coach «رضا گزی» online header, 2 starter messages,
 * input + send (local append, «الان» timestamp), one-time coach auto-reply
 * after the athlete's first message. Demo data only.
 *
 * Starter messages keep their i18n KEYS (not the translated text) so they
 * re-render in the new language when the user toggles FA/EN mid-session.
 */
import { useEffect, useRef, useState } from 'react';
import { useLang } from '../lib/i18n';

interface Msg {
  id: number;
  from: 'coach' | 'athlete';
  /** Static seed → i18n key; user-typed → literal text. */
  key?: string;
  text?: string;
  time?: string;
  /** «الان / now» label — an i18n key so it follows language switches. */
  timeKey?: string;
}

const SEEDS: Msg[] = [
  { id: 1, from: 'coach', key: 'ch.msg1', time: '21:42' },
  { id: 2, from: 'athlete', key: 'ch.msg2', time: '21:50' },
];

export default function ChatTab() {
  const { t, num, lang } = useLang();
  const [messages, setMessages] = useState<Msg[]>(SEEDS);
  const [draft, setDraft] = useState('');
  const idRef = useRef(3);
  const timerRef = useRef<number | null>(null);
  const repliedRef = useRef(false); // one-time auto-reply, per prototype spec

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const bodyOf = (m: Msg) => (m.key ? t(m.key) : (m.text ?? ''));

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const id = idRef.current++;
    setMessages((m) => [...m, { id, from: 'athlete', text, timeKey: 'ch.now' }]);
    setDraft('');
    if (repliedRef.current) return;
    repliedRef.current = true;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setMessages((m) => [...m, { id: idRef.current++, from: 'coach', key: 'ch.reply', timeKey: 'ch.now' }]);
    }, 2000);
  };

  return (
    <div className="chat-root">
      <div className="chat-header">
        <div className="chat-avatar">{lang === 'fa' ? 'ر' : 'R'}</div>
        <div className="chat-peer">
          <div className="chat-name">{t('ch.coach')}</div>
          <div className="chat-online">
            <span className="online-dot" />
            {t('ch.online')}
          </div>
        </div>
      </div>

      <div className="chat-list">
        {messages.map((m) => (
          <div key={m.id} className={m.from === 'coach' ? 'bubble coach' : 'bubble athlete'}>
            <div className="bubble-text">{bodyOf(m)}</div>
            {(m.time || m.timeKey) && (
              <div className="bubble-time">{num(m.timeKey ? t(m.timeKey) : (m.time ?? ''))}</div>
            )}
          </div>
        ))}
      </div>

      <div className="chat-input-row">
        <input
          className="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('ch.placeholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
        />
        <button type="button" className="neon-btn neon-burst chat-send" onClick={send} aria-label={t('ch.send')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
