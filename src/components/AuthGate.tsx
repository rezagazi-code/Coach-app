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
import { APP_VERSION } from '../lib/version';

type Screen = 'role' | 'coach' | 'athlete';
type Mode = 'login' | 'signup';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldKey = 'name' | 'slug' | 'email' | 'phone' | 'password' | 'confirm';
type FieldErrs = Partial<Record<FieldKey, string>>;

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
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <label className="auth-field">
      <span className="auth-label">{label}</span>
      {children}
      {error ? (
        <span className="auth-field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="auth-hint">{hint}</span>
      ) : null}
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
  const [fieldErrs, setFieldErrs] = useState<FieldErrs>({});
  const clearField = (k: FieldKey) =>
    setFieldErrs((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev));

  // coach form
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('reza');
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
      case 'takenSlug':
        // Coach link taken by another coach — inline under the slug field,
        // never the generic red box.
        setFieldErrs((prev) => ({ ...prev, slug: t('auth.errSlugTaken') }));
        break;
      case 'checkEmail':
        setNotice(t('auth.errCheckEmail'));
        setMode('login');
        break;
      case 'checkPhone':
        setNotice(t('auth.errCheckPhone'));
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
    // Per-field validation first: the error lands under the exact field
    // that is missing/invalid (and clears live as the user types), instead
    // of one generic "all fields required" for the whole form.
    const errs: FieldErrs = {};
    if (mode === 'signup') {
      if (!name.trim()) errs.name = t('auth.errFieldRequired');
      if (!slug) errs.slug = t('auth.errFieldRequired');
      else if (!SLUG_RE.test(slug)) errs.slug = t('auth.errSlug');
      if (!confirm) errs.confirm = t('auth.errFieldRequired');
      else if (password && password !== confirm) errs.confirm = t('auth.errPasswordMismatch');
    }
    if (!email.trim()) errs.email = t('auth.errFieldRequired');
    else if (!EMAIL_RE.test(email.trim())) errs.email = t('auth.errEmailInvalid');
    if (!password) errs.password = t('auth.errFieldRequired');
    else if (mode === 'signup' && password.length < 8) errs.password = t('auth.errPasswordShort');
    setFieldErrs(errs);
    if (Object.keys(errs).length > 0) return;
    if (!guardConfigured()) return;
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
    const errs: FieldErrs = {};
    if (!phone.trim()) errs.phone = t('auth.errFieldRequired');
    if (!password) errs.password = t('auth.errFieldRequired');
    setFieldErrs(errs);
    if (Object.keys(errs).length > 0) return;
    if (!guardConfigured()) return;
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
    setFieldErrs({});
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
        <form className="auth-block" noValidate onSubmit={submitCoach}>
          <button type="button" className="auth-back" onClick={() => go('role')}>
            {t('auth.back')}
          </button>
          <h1 className="auth-title">{mode === 'login' ? t('auth.coachLogin') : t('auth.coachSignup')}</h1>
          {mode === 'signup' && (
            <>
              <Field label={t('auth.fullName')} error={fieldErrs.name}>
                <input
                  {...inputProps}
                  dir={undefined}
                  type="text"
                  value={name}
                  autoComplete="name"
                  onChange={(e) => {
                    clearField('name');
                    setName(e.target.value);
                    if (!slugTouched) setSlug(deriveSlug(e.target.value));
                  }}
                />
              </Field>
              <Field label={t('auth.slug')} hint={t('auth.slugHint')} error={fieldErrs.slug}>
                <input
                  {...inputProps}
                  type="text"
                  value={slug}
                  autoComplete="username"
                  onChange={(e) => {
                    clearField('slug');
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                />
              </Field>
            </>
          )}
          <Field label={t('auth.email')} error={fieldErrs.email}>
            <input
              {...inputProps}
              type="email"
              inputMode="email"
              value={email}
              autoComplete="email"
              onChange={(e) => {
                clearField('email');
                setEmail(e.target.value);
                if (mode === 'signup' && !slugTouched) setSlug(deriveSlug(e.target.value.split('@')[0] ?? ''));
              }}
            />
          </Field>
          <Field label={t('auth.password')} error={fieldErrs.password}>
            <input
              {...inputProps}
              type="password"
              value={password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(e) => {
                clearField('password');
                setPassword(e.target.value);
              }}
            />
          </Field>
          {mode === 'signup' && (
            <Field label={t('auth.confirmPassword')} error={fieldErrs.confirm}>
              <input
                {...inputProps}
                type="password"
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => {
                  clearField('confirm');
                  setConfirm(e.target.value);
                }}
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
              setFieldErrs({});
            }}
          >
            {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')}
          </button>
        </form>
      )}

      {screen === 'athlete' && (
        <form className="auth-block" noValidate onSubmit={submitAthlete}>
          <button type="button" className="auth-back" onClick={() => go('role')}>
            {t('auth.back')}
          </button>
          <h1 className="auth-title">{t('auth.athleteLogin')}</h1>
          <Field label={t('auth.phone')} error={fieldErrs.phone}>
            <input
              {...inputProps}
              type="tel"
              inputMode="tel"
              value={phone}
              autoComplete="tel"
              onChange={(e) => {
                clearField('phone');
                setPhone(e.target.value);
              }}
            />
          </Field>
          <Field label={t('auth.password')} error={fieldErrs.password}>
            <input
              {...inputProps}
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => {
                clearField('password');
                setPassword(e.target.value);
              }}
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
      {/* Build marker reachable while logged out (PadelPro lesson: a
          version line hidden behind the auth gate can never be verified
          from a live check). Single source: package.json. */}
      <div className="auth-version">
        {t('auth.versionLabel')} {APP_VERSION}
      </div>
    </div>
  );
}

/** Orphan-coach recovery: the account exists (email confirmed after a
 *  signup whose profile write was deferred) but no coach profile row was
 *  ever created. Collect name + slug, create the INACTIVE profile via
 *  completeCoachProfile, and bootstrap routes to pending approval. */
export function CoachProfileCompletion() {
  const { t } = useLang();
  const auth = useAuth();
  const [name, setName] = useState('');
  // Prefill the canonical coach link — editable, lowercase-latin enforced.
  const [slug, setSlug] = useState('reza');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrs, setFieldErrs] = useState<{ name?: string; slug?: string }>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: { name?: string; slug?: string } = {};
    if (!name.trim()) errs.name = t('auth.errFieldRequired');
    if (!slug) errs.slug = t('auth.errFieldRequired');
    else if (!SLUG_RE.test(slug)) errs.slug = t('auth.errSlug');
    setFieldErrs(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    setError(null);
    const res = await auth.completeCoachProfile({ name, slug });
    setBusy(false);
    if (!res.ok) {
      // Honest errors: slug taken → inline under the field; anything else →
      // the generic box (the failure is logged, never silent).
      if (res.code === 'takenSlug') setFieldErrs({ slug: t('auth.errSlugTaken') });
      else setError(t('auth.errGeneric'));
    }
  };

  return (
    <div className="auth-scroll">
      <div className="auth-block neon-rise">
        <h1 className="auth-title">{t('auth.completeTitle')}</h1>
        <p className="auth-sub">{t('auth.completeBody')}</p>
        <form onSubmit={submit} noValidate>
          <Field label={t('auth.fullName')} error={fieldErrs.name}>
            <input
              {...inputProps}
              dir={undefined}
              type="text"
              value={name}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={t('auth.slug')} hint={t('auth.slugHint')} error={fieldErrs.slug}>
            <input
              {...inputProps}
              type="text"
              value={slug}
              autoComplete="username"
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
          </Field>
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="neon-btn neon-burst auth-submit" disabled={busy}>
            {busy ? t('auth.pleaseWait') : t('auth.completeSubmit')}
          </button>
          <button type="button" className="auth-switch" onClick={() => void auth.signOut()}>
            {t('auth.logout')}
          </button>
        </form>
      </div>
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
