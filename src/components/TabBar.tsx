/** Bottom tab bar — 5 tabs with inline SVG icons. */
import { useLang } from '../lib/i18n';

export type TabId = 'questionnaire' | 'workout' | 'nutrition' | 'checklist' | 'chat';

const TABS: TabId[] = ['questionnaire', 'workout', 'nutrition', 'checklist', 'chat'];

function Icon({ id }: { id: TabId }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;
  switch (id) {
    case 'questionnaire':
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    case 'workout':
      return (
        <svg {...common}>
          <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />
        </svg>
      );
    case 'nutrition':
      return (
        <svg {...common}>
          <path d="M12 3c-4 0-7 3-7 7 0 5 4 11 7 11s7-6 7-11c0-4-3-7-7-7z" />
          <path d="M12 3v18" />
        </svg>
      );
    case 'checklist':
      return (
        <svg {...common}>
          <path d="M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2L7.5 11M4 18l1.2 1.2L7.5 17M11 6h9M11 12h9M11 18h9" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common}>
          <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" />
        </svg>
      );
  }
}

export default function TabBar({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  const { t } = useLang();
  return (
    <nav className="tab-bar" aria-label={t('a11y.tabsNav')}>
      {TABS.map((id) => (
        <button
          key={id}
          type="button"
          className={active === id ? 'tab-btn active' : 'tab-btn'}
          onClick={() => onChange(id)}
          aria-selected={active === id}
        >
          <Icon id={id} />
          <span className="tab-label">{t(`tab.${id}`)}</span>
        </button>
      ))}
    </nav>
  );
}
