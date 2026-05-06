import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ROUTE_TITLES } from './nav-config';
import { NotificationPanel } from './NotificationPanel';

export function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const toggleCmdK = useUIStore((s) => s.toggleCmdK);
  const showToast = useUIStore((s) => s.showToast);
  const [notifOpen, setNotifOpen] = useState(false);

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
        className="btn btn-ghost"
        onClick={() => toggleCmdK(true)}
        style={{
          minWidth: 240,
          justifyContent: 'flex-start',
          color: 'var(--text-tertiary)',
          borderColor: 'var(--border-default)',
          background: 'var(--bg-surface)',
        }}
      >
        <Icon name="search" size={14} />
        <span style={{ flex: 1, textAlign: 'left' }}>Search cases, clients, docs…</span>
      </button>

      <ThemeToggle />

      <div style={{ position: 'relative' }}>
        <button
          className="btn btn-ghost"
          onClick={() => setNotifOpen((o) => !o)}
          style={{ padding: '0 8px' }}
          aria-label="Notifications"
        >
          <Icon name="bell" />
        </button>
        {notifOpen && (
          <NotificationPanel onClose={() => setNotifOpen(false)} onNav={(to) => navigate(`/app/${to}`)} />
        )}
      </div>

      <button
        className="btn btn-primary"
        onClick={() => {
          navigate('/app/draft');
          showToast({ type: 'cobalt', text: 'New draft started' });
        }}
        style={{ padding: '0 14px' }}
      >
        <Icon name="plus" size={14} /> New
      </button>
    </div>
  );
}
