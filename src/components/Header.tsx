/** App header: brand + FA|EN language toggle (switches dir rtl/ltr). */
import { useLang } from '../lib/i18n';

export default function Header() {
  const { t, lang, setLang } = useLang();
  return (
    <header className="coach-header">
      <div className="coach-brand">
        <img src="logo.png" alt={t('app.name')} className="coach-logo" />
        <span className="coach-title">{t('app.name')}</span>
      </div>
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
    </header>
  );
}
