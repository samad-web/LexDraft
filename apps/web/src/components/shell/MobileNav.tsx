import { useLocation, useNavigate } from 'react-router-dom';
import type { FeatureKey } from '@lexdraft/types';
import { Icon, type IconName } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { useMeFeatures } from '@/hooks/useFirmAdmin';

interface NavEntry {
  id: string;
  label: string;
  icon: IconName;
  to?: string;
  action?: 'menu';
  /** Hide the entry unless the resolver grants this feature. Mirrors the
   *  sidebar's per-item gating so we don't surface paid affordances to
   *  free-tier users. */
  requiresFeature?: FeatureKey;
}

const ITEMS: ReadonlyArray<NavEntry> = [
  { id: 'dashboard', label: 'Home',  icon: 'home',  to: '/app/dashboard' },
  { id: 'cases',     label: 'Cases', icon: 'cases', to: '/app/cases',  requiresFeature: 'matter.view' },
  { id: 'draft',     label: 'Draft', icon: 'draft', to: '/app/draft',  requiresFeature: 'drafting.ai' },
  // Tasks icon (not 'chat' — that's a wholly different feature). Earlier
  // glyph was confusing.
  { id: 'tasks',     label: 'Tasks', icon: 'tasks', to: '/app/tasks',  requiresFeature: 'matter.view' },
  { id: 'more',      label: 'More',  icon: 'more',  action: 'menu' },
];

export function MobileNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const meFeatures = useMeFeatures();
  const granted = meFeatures.data?.features ?? [];

  const visible = ITEMS.filter(
    (it) => !it.requiresFeature || granted.includes(it.requiresFeature),
  );

  return (
    <nav className="mobile-nav" aria-label="Primary mobile">
      {visible.map((it) => {
        const path = location.pathname;
        const active = it.to ? (path === it.to || path.startsWith(it.to + '/')) : false;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => {
              if (it.action === 'menu') {
                toggleSidebar(true);
              } else if (it.to) {
                navigate(it.to);
              }
            }}
            className={`mobile-nav-item${active ? ' active' : ''}`}
            aria-label={it.label}
          >
            <Icon name={it.icon} className="nav-icon" size={20} />
            <span>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
