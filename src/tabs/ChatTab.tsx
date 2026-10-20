/**
 * Tab (e) — coach chat. Coach «رضا گزی» online header, 2 starter messages,
 * input + send (local append, «الان» timestamp), coach auto-reply after 2s.
 * Demo data only.
 */
import { useRef, useState } from 'react';
import { useLang } from '../lib/i18n';

interface Msg {
  id: number;
  from: 'coach' | 'athlete';
  text: string;
  time: string;
}

export default function ChatTab() {
  const { t, num, lang } = useLang();
  const [messages, setMessages] = useState<Msg[]>([
    { id: 1, from: 'coach', text: t('ch.msg1'), time: '21:42' },
    { id: 2, from: 'athlete', text: t('ch.msg2'), time: '21:50' },
  ]);
  const [draft, setDraft] = useState('');
  const idRef = useRef(3);
  const timerRef = useRef<number | null>(null);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const id = idRef.current++;
    setMessages((m) => [...m, { id, from: 'athlete', text, time: t('ch.now') }]);
    setDraft('');
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setMessages((m) => [...m, { id: idRef.current++, from: 'coach', text: t('ch.reply'), time: t('ch.now') }]);
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
            <div className="bubble-text">{m.text}</div>
            <div className="bubble-time">{num(m.time)}</div>
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
        <button type="button" className="neon-btn neon-burst chat-send" onClick={send} aria-label="send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
