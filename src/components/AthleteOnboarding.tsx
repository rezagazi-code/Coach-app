/**
 * Athlete onboarding (§18.1): the questionnaire runs FIRST and its answers
 * stay on-device until signup (no anon DB writes); account creation is the
 * final step — phone + password via signUp({ phone, password }) — after
 * which the §18.1 step-6 profile rows are written by the auth layer.
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (auth.unconfigured) {
      setError(t('auth.notConfiguredTitle'));
      return;
    }
    if (!name.trim() || !phone.trim() || !password || !confirm) {
      setError(t('auth.errRequired'));
      return;
    }
    if (password.length < 8) {
      setError(t('auth.errPasswordShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('auth.errPasswordMismatch'));
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

      <form className="auth-block" onSubmit={submit}>
        <h2 className="section-title">{t('auth.finishSignup')}</h2>
        <label className="auth-field">
          <span className="auth-label">{t('auth.fullName')}</span>
          <input
            className="auth-input"
            type="text"
            value={name}
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
          />
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
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label className="auth-field">
          <span className="auth-label">{t('auth.password')}</span>
          <input
            className="auth-input"
            dir="ltr"
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="auth-field">
          <span className="auth-label">{t('auth.confirmPassword')}</span>
          <input
            className="auth-input"
            dir="ltr"
            type="password"
            value={confirm}
            autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)}
          />
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
