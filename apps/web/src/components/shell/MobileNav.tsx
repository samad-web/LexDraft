import { useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@lexdraft/ui';

const ITEMS: Array<{ id: string; label: string; icon: IconName; to: string }> = [
  { id: 'dashboard', label: 'Home', icon: 'home', to: '/app/dashboard' },
  { id: 'cases', label: 'Cases', icon: 'cases', to: '/app/cases' },
  { id: 'draft', label: 'Draft', icon: 'draft', to: '/app/draft' },
  { id: 'tasks', label: 'Tasks', icon: 'chat', to: '/app/tasks' },
  { id: 'more', label: 'More', icon: 'more', to: '/app/settings' },
];

export function MobileNav() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <nav className="mobile-nav">
      {ITEMS.map((it) => {
        const active = location.pathname.startsWith(it.to);
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => navigate(it.to)}
            className={`mobile-nav-item${active ? ' active' : ''}`}
          >
            <Icon name={it.icon} className="nav-icon" size={20} />
            <span>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
