/** App header: brand + FA|EN language toggle (switches dir rtl/ltr) +
 *  logout (§18.3 step 5) whenever a session — or the demo entry — is live. */
import { useLang } from '../lib/i18n';
import { useAuth } from '../lib/auth';

export default function Header() {
  const { t, lang, setLang } = useLang();
  const auth = useAuth();
  const showLogout = auth.status === 'signedIn' || auth.status === 'pending' || auth.demo;
  return (
    <header className="coach-header">
      <div className="coach-brand">
        <img src="logo.png" alt={t('app.name')} className="coach-logo" />
        <span className="coach-title">{t('app.name')}</span>
      </div>
      <div className="header-actions">
        {showLogout && (
          <button type="button" className="logout-btn" onClick={() => void auth.signOut()}>
            {t('auth.logout')}
          </button>
        )}
        <div className="lang-toggle" role="group" aria-label="Language / زبان">
          <button
            type="button"
            className={lang === 'fa' ? 'lang-btn active' : 'lang-btn'}
            onClick={() => setLang('fa')}
          >
            FA
          </button>
          <button
            type="button"
            className={lang === 'en' ? 'lang-btn active' : 'lang-btn'}
            onClick={() => setLang('en')}
          >
            EN
          </button>
        </div>
      </div>
    </header>
  );
}
