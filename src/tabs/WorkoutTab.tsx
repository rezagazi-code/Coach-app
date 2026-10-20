/**
 * Tab (b) — live session logger.
 * Header: «جلسه امروز: سینه و سرشانه» → exercise «پرس بالاسینه با دمبل».
 * 4 tappable set cards (sets 1–2 pre-logged), weight stepper ±2.5, reps ±1,
 * RPE row 7→10 with reps-in-reserve hint, big «ثبت ست», PR overlay at ≥35kg,
 * end-of-session feedback.
 */
import { useState } from 'react';
import { useLang } from '../lib/i18n';
import Toast from '../components/Toast';

interface SetLog {
  weight: number; // kg
  reps: number;
  done: boolean;
  rpe: number | null;
}

const RPE_STEPS = [
  { v: 7, fa: '~۳', en: '~3' },
  { v: 8, fa: '~۲', en: '~2' },
  { v: 8.5, fa: '۱–۲', en: '1–2' },
  { v: 9, fa: '~۱', en: '~1' },
  { v: 9.5, fa: '۰–۱', en: '0–1' },
  { v: 10, fa: '۰', en: '0' },
];

const PR_KG = 35;

export default function WorkoutTab() {
  const { t, num, lang } = useLang();
  const [sets, setSets] = useState<SetLog[]>([
    { weight: 30, reps: 12, done: true, rpe: 8 },
    { weight: 32.5, reps: 10, done: true, rpe: 9 },
    { weight: 35, reps: 8, done: false, rpe: null },
    { weight: 35, reps: 8, done: false, rpe: null },
  ]);
  const [active, setActive] = useState(2);
  const [rpe, setRpe] = useState<number | null>(null);
  const [showPR, setShowPR] = useState(false);
  const [feedback, setFeedback] = useState<'easy' | 'ok' | 'hard' | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const activeSet = sets[active];
  const allDone = sets.every((s) => s.done);

  const flash = (msg: string) => {
    setToast(null);
    requestAnimationFrame(() => setToast(msg));
    window.setTimeout(() => setToast(null), 2200);
  };

  const bump = (key: 'weight' | 'reps', delta: number) => {
    setSets((prev) => {
      const next = [...prev];
      const cur = next[active];
      if (cur.done) return prev;
      const v = key === 'weight' ? cur.weight + delta : cur.reps + delta;
      const clamped =
        key === 'weight' ? Math.max(2.5, Math.min(120, Math.round(v * 2) / 2)) : Math.max(1, Math.min(40, v));
      next[active] = { ...cur, [key]: clamped };
      return next;
    });
  };

  const logSet = () => {
    if (activeSet.done || rpe === null) return;
    const isPR = activeSet.weight >= PR_KG;
    setSets((prev) => {
      const next = [...prev];
      next[active] = { ...next[active], done: true, rpe };
      return next;
    });
    setRpe(null);
    flash(t('w.logged'));
    if (isPR) setShowPR(true);
    const nextIdx = sets.findIndex((s, i) => i > active && !s.done);
    if (nextIdx !== -1) setActive(nextIdx);
  };

  return (
    <div className="tab-pad">
      <h2 className="section-title">{t('w.sessionTitle')}</h2>
      <div className="card neon-rise">
        <div className="exercise-name">{t('w.exercise')}</div>

        {/* 4 set cards */}
        <div className="set-grid">
          {sets.map((s, i) => (
            <button
              key={i}
              type="button"
              disabled={s.done}
              onClick={() => setActive(i)}
              className={`set-card${i === active && !allDone ? ' active' : ''}${s.done ? ' done' : ''}`}
            >
              <span className="set-num">
                {t('w.set')} {num(i + 1)}
              </span>
              {s.done ? (
                <>
                  <span className="set-check" aria-label={t('w.logged')}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 12.5l5 5L20 6.5" />
                    </svg>
                  </span>
                  <span className="set-val">
                    {num(s.weight)}×{num(s.reps)}
                  </span>
                  <span className="set-rpe">RPE {num(s.rpe ?? '')}</span>
                </>
              ) : (
                <span className="set-val pending">
                  {num(s.weight)}×{num(s.reps)}
                </span>
              )}
            </button>
          ))}
        </div>

        {!allDone && !activeSet.done && (
          <>
            {/* steppers */}
            <div className="steppers">
              <div className="stepper">
                <span className="stepper-label">
                  {t('w.weight')} ({t('w.kg')})
                </span>
                <div className="stepper-row">
                  <button type="button" className="step-btn" onClick={() => bump('weight', -2.5)} aria-label="-2.5">
                    −
                  </button>
                  <span className="step-big">{num(activeSet.weight)}</span>
                  <button type="button" className="step-btn" onClick={() => bump('weight', 2.5)} aria-label="+2.5">
                    +
                  </button>
                </div>
              </div>
              <div className="stepper">
                <span className="stepper-label">{t('w.reps')}</span>
                <div className="stepper-row">
                  <button type="button" className="step-btn" onClick={() => bump('reps', -1)} aria-label="-1">
                    −
                  </button>
                  <span className="step-big">{num(activeSet.reps)}</span>
                  <button type="button" className="step-btn" onClick={() => bump('reps', 1)} aria-label="+1">
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* RPE */}
            <div className="rpe-block">
              <div className="rpe-head">
                <span>{t('w.rpe')}</span>
                <span className="rpe-sub">
                  {rpe !== null && (
                    <>
                      {t('w.rir')}: {lang === 'fa' ? RPE_STEPS.find((r) => r.v === rpe)?.fa : RPE_STEPS.find((r) => r.v === rpe)?.en}
                    </>
                  )}
                </span>
              </div>
              <div className="rpe-row">
                {RPE_STEPS.map((r) => (
                  <button
                    key={r.v}
                    type="button"
                    className={rpe === r.v ? 'rpe-btn active' : 'rpe-btn'}
                    onClick={() => setRpe(r.v)}
                  >
                    {num(r.v)}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="neon-btn neon-burst log-set-btn"
              disabled={rpe === null}
              onClick={logSet}
            >
              {t('w.logSet')}
            </button>
          </>
        )}
      </div>

      {/* end-of-session feedback */}
      {allDone && (
        <div className="card neon-rise">
          <div className="feedback-title">{t('w.sessionDone')}</div>
          {!feedback ? (
            <div className="feedback-row">
              <button type="button" className="neon-ghost feedback-btn" onClick={() => setFeedback('easy')}>
                {t('w.easy')}
              </button>
              <button type="button" className="neon-btn neon-burst feedback-btn" onClick={() => setFeedback('ok')}>
                {t('w.ok')}
              </button>
              <button type="button" className="neon-ghost feedback-btn" onClick={() => setFeedback('hard')}>
                {t('w.hard')}
              </button>
            </div>
          ) : (
            <div className="feedback-done">{t('w.finalThanks')}</div>
          )}
        </div>
      )}

      {/* PR celebration overlay */}
      {showPR && (
        <div className="pr-overlay" onClick={() => setShowPR(false)}>
          <div className="pr-card" onClick={(e) => e.stopPropagation()}>
            <svg className="pr-bolt" width="56" height="56" viewBox="0 0 24 24" fill="#D4FF00" aria-hidden>
              <path d="M13 2L4.5 13.5H11L9.5 22 19 10h-6.5L13 2z" />
            </svg>
            <div className="pr-title">{t('w.pr')}</div>
            <div className="pr-sub">{t('w.prSub')}</div>
            <button type="button" className="neon-btn neon-burst pr-ok" onClick={() => setShowPR(false)}>
              {t('w.prOk')}
            </button>
          </div>
        </div>
      )}

      <Toast msg={toast} />
    </div>
  );
}
