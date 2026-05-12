import { Outlet, useLocation } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';

const ROUTE_LABEL: Record<string, string> = {
  '/admin':          'Overview',
  '/admin/firms':    'Firms',
  '/admin/users':    'Users',
  '/admin/templates': 'Templates',
  '/admin/audit':    'Audit log',
};

function labelFor(pathname: string): string {
  if (ROUTE_LABEL[pathname]) return ROUTE_LABEL[pathname];
  if (pathname.startsWith('/admin/firms/')) return 'Firm detail';
  return 'Platform admin';
}

export function AdminShell() {
  const location = useLocation();
  return (
    <div className="app">
      <AdminSidebar />
      <div className="main">
        <header
          style={{
            padding: 'var(--space-5) var(--space-8)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-base)',
          }}
        >
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
