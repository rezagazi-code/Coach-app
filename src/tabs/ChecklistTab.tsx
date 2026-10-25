/**
 * Tab (d) — daily checklist. HABITS ONLY — never drugs, never supplements,
 * never prescriptions. Coach-assigned habits with times; tap to check off,
 * animated progress ring, «+۲ XP» toast per completion.
 *
 * Day state persists in localStorage (km.checklist.v1, per-day): without
 * it the ring reset on every app restart, and re-tapping a habit already
 * completed today showed the «+۲ XP» toast while the ledger silently
 * dropped the award as a duplicate client_uuid — a toast that lies.
 */
import { useState } from 'react';
import { useLang } from '../lib/i18n';
import Toast from '../components/Toast';
import { enqueueXpEvent, getCurrentAthleteId, localDateStr } from '../lib/supabase';

interface Habit {
  key: 'water' | 'sleep' | 'steps' | 'mobility';
  done: boolean;
}

// XP awarded per habit completion — must match the «+۲ XP» toast text (c.xp).
const HABIT_XP = 2;

const HABIT_KEYS: Habit['key'][] = ['water', 'sleep', 'steps', 'mobility'];

/** Today's persisted done-set, or null when no cache exists for today. */
function readStoredDone(): Set<string> | null {
  try {
    const raw = localStorage.getItem(CHECKLIST_LOCAL);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { date?: string; done?: string[] };
    if (parsed?.date === localDateStr() && Array.isArray(parsed.done)) return new Set(parsed.done);
  } catch {
    /* ignore */
  }
  return null;
}

function persistDone(done: string[]): void {
  try {
    localStorage.setItem(CHECKLIST_LOCAL, JSON.stringify({ date: localDateStr(), done }));
  } catch {
    /* ignore */
  }
}

// Per-day cache key (same discipline as NutritionTab's per-day caches).
const CHECKLIST_LOCAL = 'km.checklist.v1';

function initialHabits(): Habit[] {
  const stored = readStoredDone();
  if (stored) return HABIT_KEYS.map((key) => ({ key, done: stored.has(key) }));
  return [
    { key: 'water', done: false },
    { key: 'sleep', done: false },
    { key: 'steps', done: false },
    { key: 'mobility', done: true }, // morning mobility already done
  ];
}

const R = 54;
const CIRC = 2 * Math.PI * R;

export default function ChecklistTab() {
  const { t, num } = useLang();
  const [habits, setHabits] = useState<Habit[]>(initialHabits);
  const [toast, setToast] = useState<string | null>(null);

  const doneCount = habits.filter((h) => h.done).length;
  const pct = doneCount / habits.length;

  const toggle = (key: Habit['key']) => {
    const current = habits.find((h) => h.key === key);
    if (!current) return;
    const turningOn = !current.done;
    setHabits((prev) => {
      const next = prev.map((h) => (h.key === key ? { ...h, done: !h.done } : h));
      // Persist the full done-set (idempotent write — safe under
      // double-invoked updaters): a restart must restore exactly this,
      // so a completed habit never shows unchecked again.
      persistDone(next.filter((h) => h.done).map((h) => h.key));
      return next;
    });
    if (turningOn) {
      // Record the promised XP in the ledger (the toast used to claim it
      // without writing anything). Idempotent per habit/day: toggling off
      // and on re-syncs to the same meta.client_uuid and the flush path
      // skips it — no double award. Toggle-off keeps the XP (ledger is
      // additive-only by design). NOTE: checklist_completions rows are NOT
      // written — their FK needs real checklist_items rows (coach-assigned
      // habits feature), which don't exist for these built-in habits.
      // The habit's day is the DEVICE's local day (localDateStr), matching
      // NutritionTab's per-day caches and log_date. The old UTC slice cut
      // the day at 03:30 Tehran: a habit done late at night and again
      // after midnight fell in one UTC day, so the second tap showed the
      // «+۲ XP» toast while the ledger's client_uuid pre-check silently
      // dropped it as a duplicate.
      const date = localDateStr();
      enqueueXpEvent({
        athlete_id: getCurrentAthleteId(),
        event_type: 'habit_checklist',
        xp: HABIT_XP,
        meta: { client_uuid: `habit:${date}:${key}`, habit: key, date },
      });
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
