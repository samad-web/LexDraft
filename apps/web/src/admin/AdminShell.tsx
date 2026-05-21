import { Outlet, useLocation } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { AdminSidebar } from './AdminSidebar';
import { useUIStore } from '@/store/ui';

const ROUTE_LABEL: Record<string, string> = {
  '/admin':          'Overview',
  '/admin/firms':    'Firms',
  '/admin/users':    'Users',
  '/admin/templates': 'Templates',
  '/admin/audit':    'Audit log',
  '/admin/errors':   'Error log',
};

function labelFor(pathname: string): string {
  if (ROUTE_LABEL[pathname]) return ROUTE_LABEL[pathname];
  if (pathname.startsWith('/admin/firms/')) return 'Firm detail';
  return 'Platform admin';
}

export function AdminShell() {
  const location = useLocation();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  return (
    <div className="app">
      <AdminSidebar />
      <div className="main">
        <header className="admin-header">
          <button
            type="button"
            className="btn btn-ghost topbar-menu"
            onClick={() => toggleSidebar(true)}
            aria-label="Open navigation menu"
          >
            <Icon name="menu" size={18} />
          </button>
          <div>
            <div className="eyebrow">Platform admin · {labelFor(location.pathname)}</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
              {location.pathname}
            </div>
          </div>
        </header>
        <div className="content" key={location.pathname}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
