/**
 * Tab (d) — daily checklist. HABITS ONLY — never drugs, never supplements,
 * never prescriptions. Coach-assigned habits with times; tap to check off,
 * animated progress ring, «+۲ XP» toast per completion.
 */
import { useState } from 'react';
import { useLang } from '../lib/i18n';
import Toast from '../components/Toast';

interface Habit {
  key: 'water' | 'sleep' | 'steps' | 'mobility';
  done: boolean;
}

const R = 54;
const CIRC = 2 * Math.PI * R;

export default function ChecklistTab() {
  const { t, num } = useLang();
  const [habits, setHabits] = useState<Habit[]>([
    { key: 'water', done: false },
    { key: 'sleep', done: false },
    { key: 'steps', done: false },
    { key: 'mobility', done: true }, // morning mobility already done
  ]);
  const [toast, setToast] = useState<string | null>(null);

  const doneCount = habits.filter((h) => h.done).length;
  const pct = doneCount / habits.length;

  const toggle = (key: Habit['key']) => {
    const current = habits.find((h) => h.key === key);
    if (!current) return;
    const turningOn = !current.done;
    setHabits((prev) => prev.map((h) => (h.key === key ? { ...h, done: !h.done } : h)));
    if (turningOn) {
      setToast(null);
      requestAnimationFrame(() => setToast(t('c.xp')));
      window.setTimeout(() => setToast(null), 1800);
    }
  };

  return (
    <div className="tab-pad">
      <h2 className="section-title">{t('c.title')}</h2>

      <div className="card ring-card neon-rise">
        <div className="ring-wrap">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" />
            <circle
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke="#D4FF00"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - pct)}
              transform="rotate(-90 70 70)"
              className="ring-progress"
            />
          </svg>
          <div className="ring-label">
            <span className="ring-frac">{`${num(doneCount)}/${num(habits.length)}`}</span>
          </div>
        </div>
        {doneCount === habits.length && <div className="all-done">{t('c.allDone')}</div>}
      </div>

      <div className="habit-list neon-rise">
        {habits.map((h) => (
          <button
            key={h.key}
            type="button"
            className={h.done ? 'habit done' : 'habit'}
            onClick={() => toggle(h.key)}
          >
            <span className="habit-check">
              {h.done && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12.5l5 5L20 6.5" />
                </svg>
              )}
            </span>
            <span className="habit-text">
              <span className="habit-title">{t(`c.${h.key}`)}</span>
              <span className="habit-sub">{t(`c.${h.key}Sub`)}</span>
            </span>
          </button>
        ))}
      </div>

      <Toast msg={toast} />
    </div>
  );
}
