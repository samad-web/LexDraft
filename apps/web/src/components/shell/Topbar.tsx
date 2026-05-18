import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ROUTE_TITLES } from './nav-config';
import { NotificationPanel } from './NotificationPanel';
import { useUnreadCount } from '@/store/notifications';

export function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const toggleCmdK = useUIStore((s) => s.toggleCmdK);
  const [notifOpen, setNotifOpen] = useState(false);
  const unreadCount = useUnreadCount();

  const segment = location.pathname.split('/')[2] || 'dashboard';
  const meta = ROUTE_TITLES[segment] || { title: segment, eyebrow: '' };

  return (
    <div className="topbar">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {meta.title}
        </div>
        {meta.eyebrow && (
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            {meta.eyebrow.toUpperCase()}
          </div>
        )}
      </div>

      <button
        className="btn btn-ghost topbar-search"
        onClick={() => toggleCmdK(true)}
        aria-label="Open search and command palette"
        style={{
          minWidth: 240,
          justifyContent: 'flex-start',
          color: 'var(--text-tertiary)',
          borderColor: 'var(--border-default)',
          background: 'var(--bg-surface)',
          gap: 10,
        }}
      >
        <Icon name="search" size={14} />
        <span style={{ flex: 1, textAlign: 'left' }}>Search cases, clients, docs…</span>
        <kbd className="kbd" style={{ height: 20, minWidth: 20 }}>⌘K</kbd>
      </button>

      <ThemeToggle />

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
        className="btn btn-primary"
        onClick={() => navigate('/app/draft')}
        style={{ padding: '0 14px' }}
      >
        <Icon name="plus" size={14} /> New
      </button>
    </div>
  );
}
