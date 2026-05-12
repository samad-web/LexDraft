import { useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import type { IconName } from '@lexdraft/ui';
import { useAuthStore } from '@/store/auth';
import { useNavHighlighter } from '@/hooks/useNavHighlighter';

interface AdminNavItem {
  id: string;
  label: string;
  icon: IconName;
  to: string;
}

const ADMIN_NAV: AdminNavItem[] = [
  { id: 'overview',  label: 'Overview',     icon: 'dashboard', to: '/admin' },
  { id: 'firms',     label: 'Firms',        icon: 'cases',     to: '/admin/firms' },
  { id: 'users',     label: 'Users',        icon: 'clients',   to: '/admin/users' },
  { id: 'templates', label: 'Templates',    icon: 'documents', to: '/admin/templates' },
  { id: 'audit',     label: 'Audit log',    icon: 'archive',   to: '/admin/audit' },
  { id: 'errors',    label: 'Error log',    icon: 'flag',      to: '/admin/errors' },
];

export function AdminSidebar() {
  const user = useAuthStore((s) => s.user);
  const initials = (user?.name || 'AD').split(' ').map((s) => s[0]).slice(0, 2).join('');
  const navRef = useRef<HTMLElement>(null);
  const hl = useNavHighlighter(navRef);

  return (
    <aside className="sidebar">
      <div className="wordmark">
        <span className="wordmark-mark" aria-hidden />
        <span className="wordmark-full">LexDraft</span>
      </div>

      <div style={{ padding: '0 20px 8px' }}>
        <span className="badge badge-vermillion mono" style={{ fontSize: 10 }}>
          PLATFORM ADMIN
        </span>
      </div>

      <div style={{ padding: '8px 20px 12px' }} className="wordmark-full">
        <div className="row" style={{ gap: 10 }}>
          <div className="avatar">{initials}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {user?.name || 'Platform admin'}
            </div>
            <div className="mono" style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>
              {user?.email}
            </div>
          </div>
        </div>
      </div>

      <nav ref={navRef} style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        <div
          className="nav-highlighter"
          aria-hidden
          style={{
            transform: `translateY(${hl.top}px)`,
            height: hl.height,
            opacity: hl.visible ? 1 : 0,
          }}
        />
        <div className="nav-section">
          <div className="nav-group-title">Platform</div>
          {ADMIN_NAV.map((item) => (
            <NavLink
              key={item.id}
              to={item.to}
              end={item.to === '/admin'}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Icon name={item.icon} className="nav-icon" />
              <span className="nav-label" style={{ flex: 1 }}>{item.label}</span>
            </NavLink>
          ))}
        </div>

        <div className="nav-section">
          <div className="nav-group-title">Switch context</div>
          <NavLink to="/app/dashboard" className="nav-item">
            <Icon name="arrow" className="nav-icon" />
            <span className="nav-label" style={{ flex: 1 }}>Back to app</span>
          </NavLink>
        </div>
      </nav>

      <div style={{ padding: 16, borderTop: '1px solid var(--border-subtle)' }}>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.12em' }}>
          BUILD · {new Date().toISOString().slice(0, 10)}
        </div>
      </div>
    </aside>
  );
}
