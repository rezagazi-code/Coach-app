/**
 * Tab (c) — nutrition: kcal counter with progress, 4 wave-animated macro tanks
 * (tap to quick-log, animated rise), «ثبت وعده» demo meal button.
 */
import { useState } from 'react';
import { useLang } from '../lib/i18n';
import Toast from '../components/Toast';

interface TankDef {
  key: 'protein' | 'carbs' | 'fat' | 'water';
  color: string;
  wave: string;
  quick: number; // quick-log amount
  kcalPer: number; // kcal per quick-log unit
  quickMsgKey: string;
}

const TANKS: TankDef[] = [
  { key: 'protein', color: '#D4FF00', wave: 'rgba(212,255,0,0.55)', quick: 20, kcalPer: 80, quickMsgKey: 'n.quickProtein' },
  { key: 'carbs', color: '#00F0FF', wave: 'rgba(0,240,255,0.55)', quick: 30, kcalPer: 120, quickMsgKey: 'n.quickCarbs' },
  { key: 'fat', color: '#B28DFF', wave: 'rgba(178,141,255,0.55)', quick: 10, kcalPer: 90, quickMsgKey: 'n.quickFat' },
  { key: 'water', color: '#3FA9FF', wave: 'rgba(63,169,255,0.55)', quick: 0.5, kcalPer: 0, quickMsgKey: 'n.quickWater' },
];

const UNIT: Record<TankDef['key'], 'n.g' | 'n.l'> = {
  protein: 'n.g',
  carbs: 'n.g',
  fat: 'n.g',
  water: 'n.l',
};

function WaveTank({
  def,
  value,
  goal,
  onQuick,
}: {
  def: TankDef;
  value: number;
  goal: number;
  onQuick: () => void;
}) {
  const { t, num, lang } = useLang();
  const pct = Math.min(100, Math.round((value / goal) * 100));
  const unitKey = UNIT[def.key];
  return (
    <button type="button" className="tank" onClick={onQuick} title={t('n.tapHint')}>
      <div className="tank-name">{t(`n.${def.key}`)}</div>
      <div className="tank-body">
        <div className="tank-fill" style={{ height: `${pct}%`, background: def.color }}>
          <svg className="tank-wave" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden>
            <path
              d="M0,6 Q15,0 30,6 T60,6 T90,6 T120,6 T150,6 T180,6 T210,6 T240,6 L240,12 L0,12 Z"
              fill={def.wave}
            />
          </svg>
        </div>
        <div className="tank-pct">
          {num(pct)}
          {lang === 'fa' ? '٪' : '%'}
        </div>
      </div>
      <div className="tank-vals">
        {num(value)} / {num(goal)} {t(unitKey)}
      </div>
      <div className="tank-hint">{t('n.tapHint')}</div>
    </button>
  );
}

export default function NutritionTab() {
  const { t, num } = useLang();
  const [eaten, setEaten] = useState(2150);
  const goal = 2600;
  const [macros, setMacros] = useState<Record<TankDef['key'], number>>({
    protein: 165,
    carbs: 230,
    fat: 52,
    water: 2.8,
  });
  const goals = { protein: 190, carbs: 280, fat: 65, water: 3.5 } as const;
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(null);
    requestAnimationFrame(() => setToast(msg));
    window.setTimeout(() => setToast(null), 2200);
  };

  const quickLog = (def: TankDef) => {
    setMacros((m) => ({ ...m, [def.key]: Math.round((m[def.key] + def.quick) * 10) / 10 }));
    setEaten((e) => e + def.kcalPer);
    flash(t(def.quickMsgKey));
  };

  const logMeal = () => {
    setEaten((e) => e + 450);
    setMacros((m) => ({ protein: m.protein + 30, carbs: m.carbs + 45, fat: m.fat + 15, water: m.water }));
    flash(t('n.mealToast'));
  };

  const remaining = goal - eaten;
  const kcalPct = Math.min(100, Math.round((eaten / goal) * 100));

  return (
    <div className="tab-pad">
      <h2 className="section-title">{t('n.title')}</h2>

      <div className="card neon-rise">
        <div className="kcal-line">
          <span className="kcal-eaten">{num(eaten)}</span>
          <span className="kcal-sep"> / </span>
          <span className="kcal-goal">
            {num(goal)} {t('n.kcal')}
          </span>
        </div>
        <div className="kcal-bar">
          <div className="kcal-bar-fill" style={{ width: `${kcalPct}%` }} />
        </div>
        <div className={remaining >= 0 ? 'kcal-remain' : 'kcal-over'}>
          {remaining >= 0
            ? `${num(remaining)} ${t('n.remaining')}`
            : `${num(-remaining)} ${t('n.over')}`}
        </div>
      </div>

      <div className="tank-grid neon-rise">
        {TANKS.map((def) => (
          <WaveTank
            key={def.key}
            def={def}
            value={macros[def.key]}
            goal={goals[def.key]}
            onQuick={() => quickLog(def)}
          />
        ))}
      </div>

      <button type="button" className="neon-btn neon-burst log-meal-btn" onClick={logMeal}>
        {t('n.logMeal')}
      </button>

      <Toast msg={toast} />
    </div>
  );
}
