import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PortalDashboard } from '@lexdraft/types';
import { portalApi } from '@/lib/portalApi';
import { usePortalAuthStore } from '@/store/portalAuth';
import { portalStrings as t } from './strings';

/**
 * Sticky top-of-page navigation for every authenticated portal route.
 * Pulls the unread count from the dashboard payload so the Messages link
 * can surface a badge without a separate counts endpoint.
 */
export function PortalNav() {
  const navigate = useNavigate();
  const client = usePortalAuthStore((s) => s.client);
  const clear = usePortalAuthStore((s) => s.clear);

  // Light-weight, cached by React Query — the dashboard view also subscribes
  // to ['portal','dashboard'], so this rides on its cache when it's fresh.
  const dashboard = useQuery({
    queryKey: ['portal', 'dashboard'],
    queryFn: () => portalApi.get<PortalDashboard>('/dashboard'),
    enabled: !!client,
    staleTime: 30_000,
  });
  const unread = dashboard.data?.counts.unreadMessages ?? 0;

  async function signOut(): Promise<void> {
    try { await portalApi.post('/auth/sign-out'); } catch { /* best effort */ }
    clear();
    navigate('/portal/login', { replace: true });
  }

  return (
    <header style={navWrap} role="banner">
      <div style={navInner}>
        <div style={brand}>
          <span style={{ fontWeight: 600 }}>{t.appName}</span>
          {client?.name && (
            <span style={{ opacity: 0.6, fontSize: 13 }}>· {client.name}</span>
          )}
        </div>
        <nav aria-label="Portal" style={navLinks}>
          <NavLink to="/portal/dashboard" style={linkStyle} end>
            {({ isActive }) => <span style={isActive ? activeLink : undefined}>{t.navDashboard}</span>}
          </NavLink>
          <NavLink to="/portal/messages" style={linkStyle}>
            {({ isActive }) => (
              <span style={isActive ? activeLink : undefined}>
                {t.navMessages}
                {unread > 0 && <span style={badge} aria-label={`${unread} unread`}>{unread}</span>}
              </span>
            )}
          </NavLink>
          <NavLink to="/portal/profile" style={linkStyle}>
            {({ isActive }) => <span style={isActive ? activeLink : undefined}>{t.navProfile}</span>}
          </NavLink>
          <button type="button" onClick={signOut} style={btnSignOut}>{t.signOut}</button>
        </nav>
      </div>
    </header>
  );
}

const navWrap: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 10,
  background: 'var(--card, #fff)',
  borderBottom: '1px solid var(--border, #e4e4e7)',
};
const navInner: React.CSSProperties = {
  maxWidth: 980,
  margin: '0 auto',
  padding: '12px 24px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
};
const brand: React.CSSProperties = {
  display: 'flex', alignItems: 'baseline', gap: 8,
};
const navLinks: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 18, fontSize: 14,
};
const linkStyle = (): React.CSSProperties => ({
  color: 'inherit', textDecoration: 'none', padding: '4px 0',
});
const activeLink: React.CSSProperties = {
  fontWeight: 600,
  borderBottom: '2px solid var(--text, #18181b)',
  paddingBottom: 2,
};
const badge: React.CSSProperties = {
  display: 'inline-block',
  marginLeft: 6,
  padding: '0 6px',
  fontSize: 11,
  fontWeight: 600,
  background: '#dc2626',
  color: '#fff',
  borderRadius: 999,
  lineHeight: '16px',
  minWidth: 16,
  textAlign: 'center',
  verticalAlign: 'middle',
};
const btnSignOut: React.CSSProperties = {
  padding: '4px 10px', fontSize: 13, background: 'transparent',
  border: '1px solid var(--border, #d4d4d8)', borderRadius: 6, cursor: 'pointer',
  color: 'inherit',
};
