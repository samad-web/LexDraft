import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useIsFetching } from '@tanstack/react-query';
import { Icon } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ROUTE_TITLES } from './nav-config';
import { NotificationPanel } from './NotificationPanel';
import { useUnreadCount } from '@/store/notifications';
import { useSignOut } from '@/hooks/useAuth';

export function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const toggleCmdK = useUIStore((s) => s.toggleCmdK);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const [notifOpen, setNotifOpen] = useState(false);
  const unreadCount = useUnreadCount();
  const signOut = useSignOut();
  // Background-fetch indicator. A small dot pulses next to the title when
  // any react-query is in flight after the initial paint.
  const fetchingCount = useIsFetching();

  const segment = location.pathname.split('/')[2] || 'dashboard';
  const meta = ROUTE_TITLES[segment] || { title: segment, eyebrow: '' };

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
        <span className="topbar-search-label">Search cases, clients, docs…</span>
        <kbd className="kbd topbar-search-kbd">⌘K</kbd>
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
          aria-label={unreadCount > 0 ? `Notifications — ${unreadCount} unread` : 'Notifications'}
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
          <NotificationPanel onClose={() => setNotifOpen(false)} onNav={(to) => navigate(`/app/${to}`)} />
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
