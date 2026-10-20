/**
 * Athlete onboarding (§18.1): the questionnaire runs FIRST and its answers
 * stay on-device until signup (no anon DB writes); account creation is the
 * final step — phone + password (the auth layer maps the number to a
 * synthetic-email GoTrue account; see phone-as-email in lib/auth.tsx) —
 * after which the §18.1 step-6 profile rows are written by the auth layer.
 *
 * The questionnaire itself is the finalized standalone page (same iframe
 * as the پرسش‌نامه tab); it has no account step of its own, so the signup
 * card below is that missing end-step.
 */
import { useState, type FormEvent } from 'react';
import { useLang } from '../lib/i18n';
import { useAuth, type AuthErrorCode } from '../lib/auth';
import QuestionnaireTab from '../tabs/QuestionnaireTab';

export default function AthleteOnboarding({ onBack }: { onBack: () => void }) {
  const { t } = useLang();
  const auth = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrs, setFieldErrs] = useState<Partial<Record<'name' | 'phone' | 'password' | 'confirm', string>>>({});
  const clearField = (k: 'name' | 'phone' | 'password' | 'confirm') =>
    setFieldErrs((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    // Per-field validation first (same pinpointing as the gate): the error
    // names the exact field, under that field, and clears as the user types.
    const errs: typeof fieldErrs = {};
    if (!name.trim()) errs.name = t('auth.errFieldRequired');
    if (!phone.trim()) errs.phone = t('auth.errFieldRequired');
    if (!password) errs.password = t('auth.errFieldRequired');
    else if (password.length < 8) errs.password = t('auth.errPasswordShort');
    if (!confirm) errs.confirm = t('auth.errFieldRequired');
    else if (password && password !== confirm) errs.confirm = t('auth.errPasswordMismatch');
    setFieldErrs(errs);
    if (Object.keys(errs).length > 0) return;
    if (auth.unconfigured) {
      setError(t('auth.notConfiguredTitle'));
      return;
    }
    setBusy(true);
    const res = await auth.signUpAthlete({ name, phone, password });
    setBusy(false);
    if (!res.ok) {
      const code: AuthErrorCode | undefined = res.code;
      if (code === 'taken') setError(t('auth.errTaken'));
      else if (code === 'busy') setError(t('auth.errBusy'));
      else if (code === 'checkEmail') setNotice(t('auth.errCheckEmail'));
      else if (code === 'checkPhone') setNotice(t('auth.errCheckPhone'));
      else setError(t('auth.errGeneric'));
    }
    // On success the auth bootstrap flips the app into the 5 tabs.
  };

  return (
    <div className="auth-scroll">
      <div className="auth-block">
        <button type="button" className="auth-back" onClick={onBack}>
          {t('auth.back')}
        </button>
        <h1 className="auth-title">{t('auth.onboardingTitle')}</h1>
        <p className="auth-sub">{t('auth.onboardingHint')}</p>
      </div>

      <div className="onboarding-frame neon-rise">
        <QuestionnaireTab />
      </div>

      <form className="auth-block" noValidate onSubmit={submit}>
        <h2 className="section-title">{t('auth.finishSignup')}</h2>
        <label className="auth-field">
          <span className="auth-label">{t('auth.fullName')}</span>
          <input
            className="auth-input"
            type="text"
            value={name}
            autoComplete="name"
            onChange={(e) => { clearField('name'); setName(e.target.value); }}
          />
          {fieldErrs.name && <span className="auth-field-error" role="alert">{fieldErrs.name}</span>}
        </label>
        <label className="auth-field">
          <span className="auth-label">{t('auth.phone')}</span>
          <input
            className="auth-input"
            dir="ltr"
            type="tel"
            inputMode="tel"
            value={phone}
            autoComplete="tel"
            onChange={(e) => { clearField('phone'); setPhone(e.target.value); }}
          />
          {fieldErrs.phone && <span className="auth-field-error" role="alert">{fieldErrs.phone}</span>}
        </label>
        <label className="auth-field">
          <span className="auth-label">{t('auth.password')}</span>
          <input
            className="auth-input"
            dir="ltr"
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => { clearField('password'); setPassword(e.target.value); }}
          />
          {fieldErrs.password && <span className="auth-field-error" role="alert">{fieldErrs.password}</span>}
        </label>
        <label className="auth-field">
          <span className="auth-label">{t('auth.confirmPassword')}</span>
          <input
            className="auth-input"
            dir="ltr"
            type="password"
            value={confirm}
            autoComplete="new-password"
            onChange={(e) => { clearField('confirm'); setConfirm(e.target.value); }}
          />
          {fieldErrs.confirm && <span className="auth-field-error" role="alert">{fieldErrs.confirm}</span>}
        </label>
        {error && <div className="auth-error">{error}</div>}
        {notice && <div className="auth-notice">{notice}</div>}
        <button type="submit" className="neon-btn neon-burst auth-submit" disabled={busy}>
          {busy ? t('auth.pleaseWait') : t('auth.createAccount')}
        </button>
      </form>
    </div>
  );
}
