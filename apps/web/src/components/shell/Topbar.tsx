import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useIsFetching } from '@tanstack/react-query';
import { Icon } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { useMeFeatures } from '@/hooks/useFirmAdmin';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ROUTE_TITLES, locateInNav, visibleNavGroups } from './nav-config';
import { NotificationPanel } from './NotificationPanel';
import { useUnreadCount } from '@/store/notifications';
import { useNotifications } from '@/hooks/useNotifications';
import { useSignOut } from '@/hooks/useAuth';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const toggleCmdK = useUIStore((s) => s.toggleCmdK);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const [notifOpen, setNotifOpen] = useState(false);
  // Drives the server sync (poll + hydrate) and gives us API-backed mark-read
  // handlers. The unread badge still reads the store so optimistic updates and
  // any client-only notifications are reflected instantly.
  const { markRead, markAllRead } = useNotifications();
  const unreadCount = useUnreadCount();
  const signOut = useSignOut();
  // Background-fetch indicator. A small dot pulses next to the title when
  // any react-query is in flight after the initial paint.
  const fetchingCount = useIsFetching();

  // "Section › Page" straight from the sidebar config, so the Topbar always
  // names a page exactly as the sidebar does. ROUTE_TITLES covers routes
  // that aren't in the sidebar (or that this user can't see there).
  const meFeatures = useMeFeatures();
  const located = useMemo(
    () => locateInNav(visibleNavGroups(meFeatures.data?.features ?? []), location.pathname),
    [meFeatures.data, location.pathname],
  );
  const segment = location.pathname.split('/')[2] || 'dashboard';
  const fallback = ROUTE_TITLES[segment] || { title: segment, eyebrow: '' };
  const meta = located
    ? { title: located.item.label, eyebrow: located.group.title }
    : fallback;

  // Back on every page except the dashboard (the home). Prefer real history
  // so the user lands where they came from; on a fresh tab / deep link fall
  // back to the parent route (/app/cases/123 → /app/cases), else the dashboard.
  const isHome = /^\/app\/?(dashboard\/?)?$/.test(location.pathname);
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) {
      navigate(-1);
      return;
    }
    const parts = location.pathname.split('/').filter(Boolean);
    navigate(parts.length > 2 ? `/${parts.slice(0, -1).join('/')}` : '/app/dashboard');
  };

  return (
    <div className="topbar">
      <button
        type="button"
        className="btn btn-ghost topbar-menu"
        onClick={() => toggleSidebar(true)}
        aria-label="Open navigation menu"
      >
        <Icon name="menu" size={18} />
      </button>

      {!isHome && (
        <button
          type="button"
          className="btn btn-ghost topbar-back"
          onClick={goBack}
          aria-label="Go back"
          title="Back"
        >
          <Icon name="chevron" size={16} style={{ transform: 'rotate(180deg)' }} />
          <span className="topbar-back-label">Back</span>
        </button>
      )}

      <div className="topbar-title">
        <div className="topbar-title-row">
          {meta.title}
          {fetchingCount > 0 && (
            <span
              aria-label="Updating"
              title="Updating"
              className="fetch-pulse"
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--info)',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
          )}
        </div>
        {meta.eyebrow && (
          <div className="mono topbar-eyebrow">{meta.eyebrow.toUpperCase()}</div>
        )}
      </div>

      <button
        className="btn btn-ghost topbar-search"
        onClick={() => toggleCmdK(true)}
        aria-label="Open search and command palette"
      >
        <Icon name="search" size={14} />
        <span className="topbar-search-label">Search matters, CNR, clients…</span>
        <kbd className="kbd topbar-search-kbd">{IS_MAC ? '⌘K' : 'Ctrl K'}</kbd>
      </button>

      <button
        className="btn btn-ghost topbar-search-mobile"
        onClick={() => toggleCmdK(true)}
        aria-label="Search"
      >
        <Icon name="search" size={16} />
      </button>

      <div className="topbar-theme">
        <ThemeToggle />
      </div>

      <div style={{ position: 'relative' }}>
        <button
          className="btn btn-ghost"
          onClick={() => setNotifOpen((o) => !o)}
          style={{ padding: '0 8px', position: 'relative' }}
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        >
          <Icon name="bell" />
          {unreadCount > 0 && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                minWidth: 16,
                height: 16,
                padding: '0 4px',
                borderRadius: 8,
                background: 'var(--danger)',
                color: '#fff',
                fontSize: 10,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid var(--bg-base)',
                lineHeight: 1,
              }}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        {notifOpen && (
          <NotificationPanel
            onClose={() => setNotifOpen(false)}
            onNav={(to) => navigate(`/app/${to}`)}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
          />
        )}
      </div>

      <button
        className="btn btn-oxblood topbar-signout"
        onClick={() => {
          signOut();
          navigate('/');
        }}
      >
        Sign out
      </button>
    </div>
  );
}
