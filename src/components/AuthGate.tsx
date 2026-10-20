/**
 * AuthGate — the app's entry (§18): role select → coach login/signup →
 * athlete login / new-athlete questionnaire route. Rendered before the 5
 * tabs whenever there is no session; logged-in users skip it entirely.
 *
 * Also exports PendingApproval — the ONLY screen an unapproved coach sees
 * (§18.2 approval gate).
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useLang } from '../lib/i18n';
import { NOT_CONFIGURED_MESSAGE, useAuth, type AuthErrorCode } from '../lib/auth';

type Screen = 'role' | 'coach' | 'athlete';
type Mode = 'login' | 'signup';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/;

/** Derive a url-safe slug from an email local part / latin name (§18.2). */
function deriveSlug(source: string): string {
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="auth-field">
      <span className="auth-label">{label}</span>
      {children}
      {hint ? <span className="auth-hint">{hint}</span> : null}
    </label>
  );
}

const inputProps = {
  className: 'auth-input',
  dir: 'ltr' as const,
  autoComplete: 'off',
};

export default function AuthGate({ onNewAthlete }: { onNewAthlete: () => void }) {
  const { t } = useLang();
  const auth = useAuth();
  const [screen, setScreen] = useState<Screen>('role');
  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // coach form
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [email, setEmail] = useState('');
  // athlete form
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const fail = (code: AuthErrorCode | undefined, kind: 'phone' | 'email') => {
    switch (code) {
      case 'wrong':
        setError(t(kind === 'phone' ? 'auth.errWrong' : 'auth.errWrongEmail'));
        break;
      case 'taken':
        setError(t(kind === 'phone' ? 'auth.errTaken' : 'auth.errTakenEmail'));
        break;
      case 'busy':
        setError(t('auth.errBusy'));
        break;
      case 'checkEmail':
        setNotice(t('auth.errCheckEmail'));
        setMode('login');
        break;
      default:
        setError(t('auth.errGeneric'));
    }
  };

  const guardConfigured = (): boolean => {
    if (auth.unconfigured) {
      setError(t('auth.notConfiguredTitle'));
      return false;
    }
    return true;
  };

  const submitCoach = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!guardConfigured()) return;
    if (mode === 'signup') {
      if (!name.trim() || !email.trim() || !password || !confirm || !slug) {
        setError(t('auth.errRequired'));
        return;
      }
      if (!SLUG_RE.test(slug)) {
        setError(t('auth.errSlug'));
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
    } else if (!email.trim() || !password) {
      setError(t('auth.errRequired'));
      return;
    }
    setBusy(true);
    const res =
      mode === 'login'
        ? await auth.signInCoach(email, password)
        : await auth.signUpCoach({ name, email, password, slug });
    setBusy(false);
    if (!res.ok) fail(res.code, 'email');
  };

  const submitAthlete = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!guardConfigured()) return;
    if (!phone.trim() || !password) {
      setError(t('auth.errRequired'));
      return;
    }
    setBusy(true);
    const res = await auth.signInAthlete(phone, password);
    setBusy(false);
    if (!res.ok) fail(res.code, 'phone');
  };

  const go = (next: Screen, nextMode: Mode = 'login') => {
    setScreen(next);
    setMode(nextMode);
    setError(null);
    setNotice(null);
  };

  return (
    <div className="auth-scroll">
      {auth.unconfigured && (
        <div className="auth-devcard neon-rise">
          <div className="auth-devcard-title">⚠ {t('auth.notConfiguredTitle')}</div>
          <p className="auth-devcard-msg" dir="ltr">
            {NOT_CONFIGURED_MESSAGE}
          </p>
          <button type="button" className="neon-btn neon-burst auth-submit" onClick={auth.enterDemo}>
            {t('auth.enterDemo')}
          </button>
        </div>
      )}

      {screen === 'role' && (
        <div className="auth-block">
          <h1 className="auth-title neon-rise">{t('auth.roleTitle')}</h1>
          <p className="auth-sub neon-rise">{t('auth.roleSub')}</p>
          <button type="button" className="role-card neon-rise" onClick={() => go('coach')}>
            <span className="role-icon" aria-hidden>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="10" cy="8" r="3.2" />
                <path d="M13 8h7l-1.5 3H13zM10 11.2V15a4.5 4.5 0 0 0 4.5 4.5H16" />
              </svg>
            </span>
            <span className="role-text">
              <span className="role-name">{t('auth.coach')}</span>
              <span className="role-sub">{t('auth.coachSub')}</span>
            </span>
          </button>
          <button type="button" className="role-card neon-rise" style={{ animationDelay: '0.08s' }} onClick={() => go('athlete')}>
            <span className="role-icon" aria-hidden>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />
              </svg>
            </span>
            <span className="role-text">
              <span className="role-name">{t('auth.athlete')}</span>
              <span className="role-sub">{t('auth.athleteSub')}</span>
            </span>
          </button>
        </div>
      )}

      {screen === 'coach' && (
        <form className="auth-block" onSubmit={submitCoach}>
          <button type="button" className="auth-back" onClick={() => go('role')}>
            {t('auth.back')}
          </button>
          <h1 className="auth-title">{mode === 'login' ? t('auth.coachLogin') : t('auth.coachSignup')}</h1>
          {mode === 'signup' && (
            <>
              <Field label={t('auth.fullName')}>
                <input
                  {...inputProps}
                  dir={undefined}
                  type="text"
                  value={name}
                  autoComplete="name"
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slugTouched) setSlug(deriveSlug(e.target.value));
                  }}
                />
              </Field>
              <Field label={t('auth.slug')} hint={t('auth.slugHint')}>
                <input
                  {...inputProps}
                  type="text"
                  value={slug}
                  autoComplete="username"
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                />
              </Field>
            </>
          )}
          <Field label={t('auth.email')}>
            <input
              {...inputProps}
              type="email"
              inputMode="email"
              value={email}
              autoComplete="email"
              onChange={(e) => {
                setEmail(e.target.value);
                if (mode === 'signup' && !slugTouched) setSlug(deriveSlug(e.target.value.split('@')[0] ?? ''));
              }}
            />
          </Field>
          <Field label={t('auth.password')}>
            <input
              {...inputProps}
              type="password"
              value={password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {mode === 'signup' && (
            <Field label={t('auth.confirmPassword')}>
              <input
                {...inputProps}
                type="password"
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
          )}
          {error && <div className="auth-error">{error}</div>}
          {notice && <div className="auth-notice">{notice}</div>}
          <button type="submit" className="neon-btn neon-burst auth-submit" disabled={busy}>
            {busy ? t('auth.pleaseWait') : mode === 'login' ? t('auth.login') : t('auth.createAccount')}
          </button>
          <button
            type="button"
            className="auth-switch"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError(null);
              setNotice(null);
            }}
          >
            {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')}
          </button>
        </form>
      )}

      {screen === 'athlete' && (
        <form className="auth-block" onSubmit={submitAthlete}>
          <button type="button" className="auth-back" onClick={() => go('role')}>
            {t('auth.back')}
          </button>
          <h1 className="auth-title">{t('auth.athleteLogin')}</h1>
          <Field label={t('auth.phone')}>
            <input
              {...inputProps}
              type="tel"
              inputMode="tel"
              value={phone}
              autoComplete="tel"
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label={t('auth.password')}>
            <input
              {...inputProps}
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <div className="auth-error">{error}</div>}
          {notice && <div className="auth-notice">{notice}</div>}
          <button type="submit" className="neon-btn neon-burst auth-submit" disabled={busy}>
            {busy ? t('auth.pleaseWait') : t('auth.login')}
          </button>
          <button type="button" className="neon-ghost auth-alt" onClick={onNewAthlete}>
            {t('auth.newAthlete')}
          </button>
        </form>
      )}
    </div>
  );
}

/** §18.2: an unapproved coach sees ONLY this — no tabs, no data. */
export function PendingApproval() {
  const { t } = useLang();
  const auth = useAuth();
  const [checking, setChecking] = useState(false);
  return (
    <div className="auth-scroll">
      <div className="auth-block pending-block neon-rise">
        <div className="pending-icon" aria-hidden>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3.5 2" />
          </svg>
        </div>
        <h1 className="auth-title">{t('auth.pending')}</h1>
        <p className="auth-sub">{t('auth.pendingSub')}</p>
        <button
          type="button"
          className="neon-btn neon-burst auth-submit"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            await auth.refresh();
            setChecking(false);
          }}
        >
          {checking ? t('auth.pleaseWait') : t('auth.checkStatus')}
        </button>
        <button type="button" className="auth-switch" onClick={() => void auth.signOut()}>
          {t('auth.logout')}
        </button>
      </div>
    </div>
  );
}
