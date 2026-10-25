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
import { FOOD_BANK, type FoodBankItem } from '../lib/foodBank';
import {
  getCurrentAthleteId,
  getSupplementReview,
  isSupabaseConfigured,
  latestNutritionTargetsFor,
  latestNutritionLogFor,
  NUTRITION_BANK_SENTINEL,
  NUTRITION_RX_SENTINEL,
  readLocalSuppReviews,
  upsertNutritionLog,
  localDateStr,
  type NutritionFoodItem,
  type NutritionPrescription,
  type NutritionLogItem,
  type SupplementReview,
} from '../lib/supabase';
import {
  renderDoctorHandoffText,
  type SupplementDraft,
} from '../lib/supplementDraft';

const STEP: Record<NutritionFoodItem['unit'], number> = { g: 25, pcs: 1, cup: 0.5, ml: 100 };
const PLATE_LOCAL = 'km.plate.v1'; // demo-mode / offline per-day cache
const PLATE_LOCAL_RX = 'km.plate.v1.rx'; // same, for «نسخه پزشک» checkboxes
const BANK_LOCAL = 'km.bank.v1'; // same, for «بانک غذاها» tap counts

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

/**
 * 🩺 «گزارش برای پزشک» — doctor handoff card (trainee side).
 *
 * RED LINES: renders ONLY from an APPROVED supplement review (coach gate
 * passed). The trainee never sees the unapproved AI draft. Candidate
 * language only — no doses, no timing, no prescription. The doctor makes
 * all dose-level decisions; the existing «نسخه پزشک» checkboxes below
 * capture what the doctor actually prescribed (names only).
 */
function DoctorHandoffCard({ athleteId, athleteName }: { athleteId: string | null; athleteName: string }) {
  const { t, lang } = useLang();
  const [review, setReview] = useState<SupplementReview | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!athleteId) return;
      try {
        const row = isSupabaseConfigured
          ? (await getSupplementReview(athleteId).catch(() => null)) ??
            // Fallback: a decision saved locally (migration not run / offline)
            readLocalSuppReviews()[athleteId] ??
            null
          : readLocalSuppReviews()[athleteId] ?? null;
        // Belt-and-suspenders: the handoff renders for approved reviews only
        // (RLS already restricts athlete reads to approved).
        // A successful read of a non-approved row CLEARS the card: without
        // this, a coach reopen (approve → pending) would leave the revoked
        // handoff visible until restart. Read failures leave the card
        // untouched (no flicker on a transient offline blip).
        if (alive) setReview(row && row.status === 'approved' ? row : null);
      } catch {
        /* leave hidden */
      }
    };
    void load();
    // All tabs stay mounted (App.tsx: display:none), so this effect runs
    // exactly once per app start — a coach approval arriving while the
    // trainee's app is open would otherwise never appear until restart.
    // Re-check whenever the app returns to the foreground: that is the
    // realistic approval-arrival moment (coach approves, tells the
    // trainee, the trainee opens/foregrounds the app).
    const onForeground = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
    };
  }, [athleteId]);

  if (!review) return null;
  const snap = review.draft_snapshot as unknown as Partial<SupplementDraft> | null;
  const draft: SupplementDraft | null =
    snap && Array.isArray(snap.candidates) ? (snap as SupplementDraft) : null;
  if (!draft) return null;

  const copy = async () => {
    const text = renderDoctorHandoffText(draft, athleteName, null);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };

  const L = (b: { fa: string; en: string }) => (lang === 'fa' ? b.fa : b.en);

  return (
    <div className="card neon-rise plate-handoff">
      <h3 className="plate-rx-title">{t('s.reportTitle')}</h3>
      <p className="plate-rx-hint">{t('s.reportSub')}</p>
      {draft.screeningSummary?.length > 0 && (
        <ul className="supp-list">
          {draft.screeningSummary.map((s, i) => (
            <li key={i}>{L(s)}</li>
          ))}
        </ul>
      )}
      {draft.candidates?.length > 0 && (
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
      )}
      {draft.interactionCautions?.length > 0 && (
        <ul className="supp-list">
          {draft.interactionCautions.map((c, i) => (
            <li key={i} className="supp-caution">
              {L(c)}
            </li>
          ))}
        </ul>
      )}
      {draft.doctorQuestions?.length > 0 && (
        <>
          <p className="supp-sec-title">{t('s.doctorQuestionsTitle')}</p>
          <ul className="supp-list">
            {draft.doctorQuestions.map((q, i) => (
              <li key={i}>{L(q)}</li>
            ))}
          </ul>
        </>
      )}
      <p className="supp-disclaimer" role="note">
        ⚠ {L(draft.disclaimer)}
      </p>
      <button type="button" className="neon-btn neon-burst" onClick={() => void copy()}>
        {copied ? t('s.reportCopied') : t('s.reportCopy')}
      </button>
    </div>
  );
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
  const [bankQuery, setBankQuery] = useState('');
  const [bankTaps, setBankTaps] = useState<Record<string, number>>({});
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
      const rawRx = localStorage.getItem(PLATE_LOCAL_RX);
      if (rawRx) {
        const parsedRx = JSON.parse(rawRx) as { date?: string; rxDone?: Record<string, boolean> };
        if (parsedRx?.date === localDateStr() && parsedRx.rxDone) setRxDone(parsedRx.rxDone);
      }
      const rawBank = localStorage.getItem(BANK_LOCAL);
      if (rawBank) {
        const parsedBank = JSON.parse(rawBank) as { date?: string; taps?: Record<string, number> };
        if (parsedBank?.date === localDateStr() && parsedBank.taps) setBankTaps(parsedBank.taps);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const loadTargets = async (silent: boolean) => {
      if (!silent) setLoading(true);
      if (!isSupabaseConfigured) {
        if (alive) {
          setItems(demoItems());
          setRx(demoRx());
          if (!silent) setLoading(false);
        }
        return;
      }
      // Fresh prescription keys, for the server-log seed below: seeding
      // rx ticks must respect the same prune, or a removed prescription
      // would come back as «taken» from yesterday's saved log.
      let freshKeys: Set<string> | null = null;
      try {
        if (!athleteId) {
          if (alive && !silent) setLoading(false);
          return;
        }
        const row = await latestNutritionTargetsFor(athleteId);
        if (alive) {
          setItems(row?.food_items ?? []);
          const freshRx = row?.prescriptions ?? [];
          setRx(freshRx);
          // Prune «taken» ticks for prescriptions the coach removed from
          // the plate: rxDone is keyed by name, not by the live rx list,
          // so without this a removed name would still ride the next
          // «ثبت روز» as taken — a ghost prescription in the coach's log.
          freshKeys = new Set(freshRx.map((p) => `${p.name_fa}|${p.name_en}`));
          const keys = freshKeys;
          setRxDone((prev) => {
            let changed = false;
            const next: Record<string, boolean> = {};
            for (const [k, v] of Object.entries(prev)) {
              if (keys.has(k)) next[k] = v;
              else changed = true;
            }
            if (changed) persistRxLocal(next);
            return changed ? next : prev;
          });
        }
      } catch (err) {
        console.error('[nutrition] targets load failed', err);
      }
      // Seed today's plate from the server's saved log when this device
      // has no local cache for today (reinstall / new device / cleared
      // storage). Without this the plate renders all zeros, and one
      // «ثبت روز» tap overwrites the saved day with a zero log — the
      // save is a full-row upsert, not a merge, so the saved day silently
      // vanishes. Local taps always win: categories with a today cache
      // are skipped, and the functional merge keeps any key tapped after
      // the cache check. Runs after the targets fetch so the rx prune
      // above (not a resurrected tick) decides what «taken» means.
      if (athleteId) {
        try {
          const log = await latestNutritionLogFor(athleteId, 0);
          if (alive && log && log.log_date === localDateStr()) {
            const hasTodayCache = (key: string): boolean => {
              try {
                const raw = localStorage.getItem(key);
                if (!raw) return false;
                return (JSON.parse(raw) as { date?: string }).date === localDateStr();
              } catch {
                return false;
              }
            };
            // «ذخیره شد» is only truthful when the whole visible plate came
            // from the server: if ANY category has a today cache, its taps
            // may be unsaved, and stamping the day saved would lie exactly
            // like the pre-0.2.35 false-«synced» trap (a server log for
            // today can exist from another device while this device holds
            // unsaved taps). No-rx counts as seeded: nothing to show.
            const plateCached = hasTodayCache(PLATE_LOCAL);
            const bankCached = hasTodayCache(BANK_LOCAL);
            const rxCached = hasTodayCache(PLATE_LOCAL_RX);
            if (!plateCached) {
              const seeded: Record<string, number> = {};
              for (const it of log.items) {
                if (it.key === NUTRITION_RX_SENTINEL || it.key === NUTRITION_BANK_SENTINEL) continue;
                if (typeof it.amount === 'number') seeded[it.key] = it.amount;
              }
              if (Object.keys(seeded).length > 0) {
                setLogged((prev) => {
                  const next = { ...seeded, ...prev };
                  persistLocal(next);
                  return next;
                });
              }
            }
            if (!bankCached) {
              const seededBank: Record<string, number> = {};
              for (const it of log.items) {
                if (it.key !== NUTRITION_BANK_SENTINEL || typeof it.bankId !== 'string') continue;
                if (typeof it.amount === 'number' && it.amount > 0) {
                  seededBank[it.bankId] = (seededBank[it.bankId] ?? 0) + it.amount;
                }
              }
              if (Object.keys(seededBank).length > 0) {
                setBankTaps((prev) => {
                  const next = { ...seededBank, ...prev };
                  persistBank(next);
                  return next;
                });
              }
            }
            if (freshKeys && !rxCached) {
              const seededRx: Record<string, boolean> = {};
              for (const it of log.items) {
                if (it.key !== NUTRITION_RX_SENTINEL || !Array.isArray(it.rxTaken)) continue;
                for (const k of it.rxTaken) {
                  if (typeof k === 'string' && freshKeys.has(k)) seededRx[k] = true;
                }
              }
              if (Object.keys(seededRx).length > 0) {
                setRxDone((prev) => {
                  const next = { ...seededRx, ...prev };
                  persistRxLocal(next);
                  return next;
                });
              }
            }
            // Only a fully seeded plate equals the server log; a partial
            // seed leaves unsaved local taps behind the «saved» label.
            // freshKeys MUST be non-null: when the targets fetch fails it
            // stays null, the rx seed above is skipped, and stamping saved
            // would let the next «ثبت روز» upsert a log that drops the
            // server's rx-taken ticks (same false-«saved» trap class).
            if (!plateCached && !bankCached && freshKeys && !rxCached) setSavedToday(true);
          }
        } catch (err) {
          console.error('[nutrition] server log seed failed', err);
        }
      }
      if (alive && !silent) setLoading(false);
    };
    void loadTargets(false);
    // Same trap class as the 0.2.29–0.2.32 foreground fixes, one level
    // deeper: all tabs stay mounted (display:none), so this effect ran
    // once per app start — a coach plate edit arriving while the
    // trainee's app was backgrounded left the trainee logging (and
    // saving, with its over-target flags computed) against STALE targets.
    // Re-check silently on foreground; logged amounts are keyed by item
    // key, so amounts for surviving items are untouched and removed
    // items simply stop rendering (and stop being saved).
    const onForeground = () => {
      if (!isSupabaseConfigured) return;
      if (document.visibilityState === 'visible') void loadTargets(true);
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
    };
  }, [athleteId]);

  const persistLocal = (next: Record<string, number>) => {
    try {
      localStorage.setItem(PLATE_LOCAL, JSON.stringify({ date: localDateStr(), logged: next }));
    } catch {
      /* ignore */
    }
  };

  // «نسخه پزشک» checkboxes have their own cache key so the toggle never
  // races the amount steppers (same functional-update persist pattern).
  const persistRxLocal = (next: Record<string, boolean>) => {
    try {
      localStorage.setItem(PLATE_LOCAL_RX, JSON.stringify({ date: localDateStr(), rxDone: next }));
    } catch {
      /* ignore */
    }
  };

  // «بانک غذاها» tap counts — same per-day local cache discipline.
  const persistBank = (next: Record<string, number>) => {
    try {
      localStorage.setItem(BANK_LOCAL, JSON.stringify({ date: localDateStr(), taps: next }));
    } catch {
      /* ignore */
    }
  };

  const tapBank = (id: string) => {
    setSavedToday(false);
    setBankTaps((prev) => {
      const next = { ...prev, [id]: (prev[id] ?? 0) + 1 };
      persistBank(next);
      return next;
    });
    flash(t('n.bankAdded'));
  };

  const removeBankTap = (id: string) => {
    setSavedToday(false);
    setBankTaps((prev) => {
      const next = { ...prev };
      delete next[id];
      persistBank(next);
      return next;
    });
  };

  // % of the day's same-unit plate target that one bank tap represents.
  // null when no program target exists for that unit (section stays
  // honest: the preview line only shows what the targets support).
  const bankPctOfDay = (f: FoodBankItem): number | null => {
    const same = items.filter((it) => it.unit === f.unit);
    if (same.length === 0) return null;
    const total = same.reduce((s, it) => s + it.target, 0);
    if (total <= 0) return null;
    return Math.round((f.tapAmount / total) * 100);
  };

  const q = bankQuery.trim().toLowerCase();
  const bankFiltered = FOOD_BANK.filter(
    (f) =>
      q === '' ||
      f.nameFA.includes(bankQuery.trim()) ||
      f.nameEN.toLowerCase().includes(q) ||
      f.id.includes(q)
  );

  const bankTodayIds = Object.keys(bankTaps).filter((id) => (bankTaps[id] ?? 0) > 0);
  const bankTodayKcal = bankTodayIds.reduce((s, id) => {
    const f = FOOD_BANK.find((x) => x.id === id);
    return s + (f ? Math.round(f.perUnitKcal * (bankTaps[id] ?? 0)) : 0);
  }, 0);

  const setAmount = (key: string, amount: number) => {
    const v = Math.max(0, Math.round(amount * 100) / 100);
    setSavedToday(false);
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
    setSavedToday(false);
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
    // «بانک غذاها» taps ride the SAME upsert path as the steppers: one
    // '__bank' sentinel entry per food (no plate item key, over=false, so
    // the coach's over-eating flags never see them). Macros are approx.
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const bankEntries: NutritionLogItem[] = Object.entries(bankTaps)
      .map(([bankId, count]): NutritionLogItem | null => {
        const f = FOOD_BANK.find((x) => x.id === bankId);
        if (!f || count <= 0) return null;
        return {
          key: NUTRITION_BANK_SENTINEL,
          bankId: f.id,
          amount: count,
          kcal: Math.round(f.perUnitKcal * count),
          protein: r1(f.perUnitProtein * count),
          carbs: r1(f.perUnitCarbs * count),
          fat: r1(f.perUnitFat * count),
          over: false,
        };
      })
      .filter((x): x is NutritionLogItem => x !== null);
    const allItems = [...logItems, ...bankEntries];
    // «نسخه پزشک» adherence: the fa|en keys the trainee checked as taken.
    const rxTaken = Object.keys(rxDone).filter((k) => rxDone[k]);
    if (!isSupabaseConfigured || !athleteId) {
      persistLocal(logged);
      persistRxLocal(rxDone);
      persistBank(bankTaps);
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
        items: allItems,
        score,
        rx_taken: rxTaken,
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

          {/* ——— «بانک غذاها» (Food bank) ——— */}
          <div className="card neon-rise bank-section">
            <h3 className="bank-title">🍏 {t('n.bankTitle')}</h3>
            <input
              className="bank-search"
              type="search"
              value={bankQuery}
              placeholder={t('n.bankSearch')}
              onChange={(e) => setBankQuery(e.target.value)}
              aria-label={t('n.bankSearch')}
            />
            {bankFiltered.length === 0 ? (
              <p className="cp-empty">{t('n.bankNoResults')}</p>
            ) : (
              <div className="bank-grid">
                {bankFiltered.map((f) => {
                  const pct = bankPctOfDay(f);
                  const note = lang === 'fa' ? f.vitaminNoteFA : f.vitaminNoteEN;
                  return (
                    <div className="card bank-item" key={f.id}>
                      <div className="bank-item-head">
                        <span className="bank-item-name">
                          {lang === 'fa' ? f.nameFA : f.nameEN}
                        </span>
                        <span className="bank-item-serving">
                          {lang === 'fa' ? f.servingFA : f.servingEN}
                        </span>
                      </div>
                      <div className="bank-item-preview">
                        +{lang === 'fa' ? '۱ واحد' : '1 unit'} ≈ {num(f.perUnitKcal)}{' '}
                        {t('n.kcal')}، {num(f.perUnitProtein)} {t('n.g')}{' '}
                        {t('n.protein')}
                        <span className="bank-approx"> · {t('n.bankApprox')}</span>
                      </div>
                      {pct !== null && (
                        <div className="bank-item-share">
                          ≈ {num(pct)}
                          {lang === 'fa' ? '٪' : '%'} {t('n.bankOfDayTarget')}
                        </div>
                      )}
                      {note && (
                        <div className="bank-item-note">
                          {t('n.bankNoteLabel')}: {note}
                        </div>
                      )}
                      <button
                        type="button"
                        className="bank-add"
                        onClick={() => tapBank(f.id)}
                      >
                        {t('n.bankAdd')}
                        {bankTaps[f.id] ? ` ×${num(bankTaps[f.id])}` : ''}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {bankTodayIds.length > 0 && (
              <div className="bank-today">
                <div className="bank-today-title">{t('n.bankTodayTitle')}</div>
                {bankTodayIds.map((id) => {
                  const f = FOOD_BANK.find((x) => x.id === id);
                  if (!f) return null;
                  const count = bankTaps[id] ?? 0;
                  return (
                    <div className="bank-today-row" key={id}>
                      <span>
                        {lang === 'fa' ? f.nameFA : f.nameEN} ×{num(count)}
                      </span>
                      <span className="bank-today-kcal">
                        ≈ {num(Math.round(f.perUnitKcal * count))} {t('n.kcal')}
                      </span>
                      <button
                        type="button"
                        className="bank-today-del"
                        aria-label={t('n.bankRemove')}
                        onClick={() => removeBankTap(id)}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
                <div className="bank-today-total">
                  {t('n.bankApprox')} {num(bankTodayKcal)} {t('n.kcal')}
                </div>
              </div>
            )}
            <p className="bank-disclaimer">{t('n.bankDisclaimer')}</p>
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
                      onChange={() => {
                        setSavedToday(false);
                        setRxDone((prev) => {
                          const next = { ...prev, [k]: !prev[k] };
                          persistRxLocal(next);
                          return next;
                        });
                      }}
                    />
                    <span>{rxLabel(p, lang)}</span>
                    <span className="plate-rx-took">{t('n.tookIt')}</span>
                  </label>
                );
              })}
            </div>
          )}

          {/* 🩺 Doctor handoff — renders only from an APPROVED supplement review */}
          <DoctorHandoffCard athleteId={athleteId} athleteName={auth.athlete?.full_name ?? ''} />

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
