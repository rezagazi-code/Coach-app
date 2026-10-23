/**
 * Tab (c) — «بشقاب روزانه» (Daily Plate).
 *
 * The coach sets the daily food program in the coach panel (per athlete:
 * food items with targets + doctor-prescribed supplement NAMES only).
 * The trainee logs what they actually ate here:
 *   - each food item: stepper (− / +), per-item «از اول» (reset), and a
 *     «بیشتر خوردم» (ate more) quick action — the stepper is the fix for
 *     "tapped next too many times, can't reduce or restart".
 *   - logged > target → the item is flagged «بیش از هدف»; the flag rides
 *     the saved log and the coach sees an over-eating red flag on the
 *     athlete card (same .cp-redflag visual language as injury flags).
 *   - «نسخه پزشک»: daily checkboxes for doctor-prescribed supplement
 *     names. ⛔ Medication boundary: names only, no dosages — the app
 *     never suggests supplement dosages; that lane is the doctor's.
 *   - «ثبت روز» saves the day (upsert on athlete_id+log_date).
 *
 * Demo mode (server unconfigured): sample program, clearly labeled,
 * stored on this device only.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLang } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import Toast from '../components/Toast';
import {
  getCurrentAthleteId,
  isSupabaseConfigured,
  latestNutritionTargetsFor,
  upsertNutritionLog,
  localDateStr,
  type NutritionFoodItem,
  type NutritionPrescription,
  type NutritionLogItem,
} from '../lib/supabase';

const STEP: Record<NutritionFoodItem['unit'], number> = { g: 25, pcs: 1, cup: 0.5, ml: 100 };
const PLATE_LOCAL = 'km.plate.v1'; // demo-mode / offline per-day cache

function demoItems(): NutritionFoodItem[] {
  return [
    { key: 'chicken', label_fa: 'مرغ (سینه)', label_en: 'Chicken breast', unit: 'g', target: 200 },
    { key: 'rice', label_fa: 'برنج پخته', label_en: 'Cooked rice', unit: 'g', target: 300 },
    { key: 'eggs', label_fa: 'تخم‌مرغ', label_en: 'Eggs', unit: 'pcs', target: 3 },
    { key: 'milk', label_fa: 'شیر', label_en: 'Milk', unit: 'cup', target: 2 },
  ];
}
function demoRx(): NutritionPrescription[] {
  return [{ name_fa: 'ویتامین D', name_en: 'Vitamin D' }];
}

function itemLabel(it: NutritionFoodItem, lang: 'fa' | 'en'): string {
  return lang === 'fa' ? it.label_fa : it.label_en;
}
function rxLabel(rx: NutritionPrescription, lang: 'fa' | 'en'): string {
  return lang === 'fa' ? rx.name_fa : rx.name_en;
}

function ScoreRing({ score }: { score: number }) {
  const { t, num, lang } = useLang();
  const r = 34;
  const c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  return (
    <div className="plate-score">
      <svg viewBox="0 0 84 84" className="plate-ring" aria-hidden>
        <circle cx="42" cy="42" r={r} className="plate-ring-bg" />
        <circle
          cx="42"
          cy="42"
          r={r}
          className="plate-ring-fg"
          strokeDasharray={c}
          strokeDashoffset={off}
        />
      </svg>
      <div className="plate-score-num">
        {num(score)}
        <span className="plate-score-pct">{lang === 'fa' ? '٪' : '%'}</span>
      </div>
      <div className="plate-score-label">{t('n.todayScore')}</div>
    </div>
  );
}

export default function NutritionTab() {
  const { t, num, lang } = useLang();
  const auth = useAuth();
  const [items, setItems] = useState<NutritionFoodItem[]>([]);
  const [rx, setRx] = useState<NutritionPrescription[]>([]);
  const [logged, setLogged] = useState<Record<string, number>>({});
  const [rxDone, setRxDone] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedToday, setSavedToday] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const athleteId = auth.athlete?.id ?? getCurrentAthleteId();
  const coachId = auth.athlete?.coach_id ?? null;

  const flash = useCallback((msg: string) => {
    setToast(null);
    requestAnimationFrame(() => setToast(msg));
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  // Restore today's local amounts (demo mode / offline echo).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PLATE_LOCAL);
      if (raw) {
        const parsed = JSON.parse(raw) as { date?: string; logged?: Record<string, number> };
        if (parsed?.date === localDateStr() && parsed.logged) setLogged(parsed.logged);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      if (!isSupabaseConfigured) {
        if (alive) {
          setItems(demoItems());
          setRx(demoRx());
          setLoading(false);
        }
        return;
      }
      try {
        if (!athleteId) {
          if (alive) setLoading(false);
          return;
        }
        const row = await latestNutritionTargetsFor(athleteId);
        if (alive) {
          setItems(row?.food_items ?? []);
          setRx(row?.prescriptions ?? []);
        }
      } catch (err) {
        console.error('[nutrition] targets load failed', err);
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [athleteId]);

  const persistLocal = (next: Record<string, number>) => {
    try {
      localStorage.setItem(PLATE_LOCAL, JSON.stringify({ date: localDateStr(), logged: next }));
    } catch {
      /* ignore */
    }
  };

  const setAmount = (key: string, amount: number) => {
    const v = Math.max(0, Math.round(amount * 100) / 100);
    setLogged((prev) => {
      const next = { ...prev, [key]: v };
      persistLocal(next);
      return next;
    });
  };

  // Rapid taps (React batches setState): each tap must read the LATEST
  // amount, not the render closure's stale one — otherwise 10 fast taps
  // collapse into one. Reza's «بیشتر خوردم» spam-tap is exactly this.
  const bumpAmount = (key: string, delta: number) => {
    setLogged((prev) => {
      const v = Math.max(0, Math.round(((prev[key] ?? 0) + delta) * 100) / 100);
      const next = { ...prev, [key]: v };
      persistLocal(next);
      return next;
    });
  };

  const score = items.length === 0
    ? 0
    : Math.round(
        (items.reduce((s, it) => s + Math.min((logged[it.key] ?? 0) / it.target, 1), 0) /
          items.length) *
          100
      );

  const saveDay = async () => {
    if (saving) return;
    setSaving(true);
    const logItems: NutritionLogItem[] = items.map((it) => {
      const amount = logged[it.key] ?? 0;
      return { key: it.key, amount, over: amount > it.target };
    });
    if (!isSupabaseConfigured || !athleteId) {
      persistLocal(logged);
      setSavedToday(true);
      flash(t('n.savedLocal'));
      setSaving(false);
      return;
    }
    try {
      await upsertNutritionLog({
        athlete_id: athleteId,
        coach_id: coachId,
        log_date: localDateStr(),
        items: logItems,
        score,
      });
      setSavedToday(true);
      flash(t('n.saved'));
    } catch (err) {
      console.error('[nutrition] save failed', err);
      flash(t('n.saveError'));
    }
    setSaving(false);
  };

  return (
    <div className="tab-pad">
      <h2 className="section-title">{t('n.plateTitle')}</h2>
      {auth.unconfigured && <div className="cp-demo-note">⚠ {t('cp.demoNote')}</div>}

      {loading ? (
        <p className="cp-empty">{t('cp.loading')}</p>
      ) : items.length === 0 ? (
        <div className="card neon-rise">
          <p className="cp-empty">{t('n.noProgram')}</p>
        </div>
      ) : (
        <>
          <div className="card neon-rise plate-hero">
            <ScoreRing score={score} />
          </div>

          <div className="plate-grid">
            {items.map((it) => {
              const amount = logged[it.key] ?? 0;
              const pct = Math.min(100, Math.round((amount / it.target) * 100));
              const over = amount > it.target;
              const step = STEP[it.unit];
              return (
                <div className="card plate-item neon-rise" key={it.key}>
                  <div className="plate-item-head">
                    <span className="plate-item-name">{itemLabel(it, lang)}</span>
                    {over && <span className="plate-over-badge">⚠ {t('n.overBadge')}</span>}
                  </div>
                  <div className="plate-item-target">
                    {t('n.target')}: {num(it.target)} {t(`n.unit.${it.unit}`)}
                  </div>
                  <div className="plate-bar">
                    <div
                      className={over ? 'plate-bar-fill over' : 'plate-bar-fill'}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="plate-amount">
                    {num(amount)} / {num(it.target)} {t(`n.unit.${it.unit}`)}
                  </div>
                  <div className="plate-controls">
                    <button
                      type="button"
                      className="plate-step"
                      aria-label={t('n.stepDown')}
                      onClick={() => bumpAmount(it.key, -step)}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className="plate-step"
                      aria-label={t('n.stepUp')}
                      onClick={() => bumpAmount(it.key, step)}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="plate-reset"
                      onClick={() => setAmount(it.key, 0)}
                    >
                      {t('n.resetItem')}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="plate-more"
                    onClick={() => bumpAmount(it.key, step)}
                  >
                    🍽 {t('n.ateMore')}
                  </button>
                </div>
              );
            })}
          </div>

          {rx.length > 0 && (
            <div className="card neon-rise plate-rx">
              <h3 className="plate-rx-title">💊 {t('n.prescriptions')}</h3>
              <p className="plate-rx-hint">{t('n.prescriptionHint')}</p>
              {rx.map((p, i) => {
                const k = `${p.name_fa}|${p.name_en}`;
                return (
                  <label className="plate-rx-row" key={k + i}>
                    <input
                      type="checkbox"
                      checked={!!rxDone[k]}
                      onChange={() =>
                        setRxDone((prev) => ({ ...prev, [k]: !prev[k] }))
                      }
                    />
                    <span>{rxLabel(p, lang)}</span>
                    <span className="plate-rx-took">{t('n.tookIt')}</span>
                  </label>
                );
              })}
            </div>
          )}

          <button
            type="button"
            className="neon-btn neon-burst plate-save"
            disabled={saving}
            onClick={() => void saveDay()}
          >
            {saving ? t('auth.pleaseWait') : savedToday ? t('n.saved') : t('n.saveDay')}
          </button>
        </>
      )}
      <Toast msg={toast} />
    </div>
  );
}
