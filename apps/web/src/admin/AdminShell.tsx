import { Outlet, useLocation } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';

export function AdminShell() {
  const location = useLocation();
  return (
    <div className="app">
      <AdminSidebar />
      <div className="main">
        <header
          style={{
            padding: '16px 32px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-base)',
          }}
        >
          <div>
            <div className="eyebrow">Platform admin</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
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
