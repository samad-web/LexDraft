import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import {
  useNotificationsStore,
  formatRelativeTime,
  type Notification,
  type NotificationTone,
} from '@/store/notifications';

type Tab = 'all' | 'unread';

function toneToColor(tone: NotificationTone): string {
  switch (tone) {
    case 'cobalt':     return 'var(--info)';
    case 'sage':       return 'var(--success)';
    case 'amber':      return 'var(--warning)';
    case 'vermillion': return 'var(--danger)';
  }
}

export function NotificationPanel({
  onClose,
  onNav,
}: {
  onClose: () => void;
  onNav: (view: string) => void;
}) {
  const items = useNotificationsStore((s) => s.items);
  const markRead = useNotificationsStore((s) => s.markRead);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const dismiss = useNotificationsStore((s) => s.dismiss);
  const [tab, setTab] = useState<Tab>('all');

  const filtered = tab === 'unread' ? items.filter((n) => n.unread) : items;
  const unreadCount = items.filter((n) => n.unread).length;

  function openNotification(n: Notification): void {
    markRead(n.id);
    onNav(n.view);
    onClose();
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div
        role="dialog"
        aria-label="Notifications"
        style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          width: 380,
          maxHeight: 520,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-popover)',
          zIndex: 41,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          className="row"
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border-subtle)',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div className="eyebrow">Notifications</div>
            <div style={{ fontSize: 14, fontWeight: 500, marginTop: 2 }}>
              Inbox
              {unreadCount > 0 && (
                <span
                  className="mono"
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--danger-bg)',
                    color: 'var(--danger)',
                  }}
                >
                  {unreadCount} new
                </span>
              )}
            </div>
          </div>
          <button
            className="btn btn-sm btn-ghost mono"
            style={{ fontSize: 10, letterSpacing: '0.12em' }}
            onClick={markAllRead}
            disabled={unreadCount === 0}
          >
            MARK ALL READ
          </button>
        </div>
        {/* Filter tabs */}
        <div
          className="row"
          role="tablist"
          style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', gap: 4 }}
        >
          <button
            role="tab"
            aria-selected={tab === 'all'}
            className={`btn btn-sm ${tab === 'all' ? '' : 'btn-ghost'}`}
            onClick={() => setTab('all')}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            All ({items.length})
          </button>
          <button
            role="tab"
            aria-selected={tab === 'unread'}
            className={`btn btn-sm ${tab === 'unread' ? '' : 'btn-ghost'}`}
            onClick={() => setTab('unread')}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            Unread ({unreadCount})
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div
              style={{
                padding: 32,
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name="bell" size={20} className="muted" />
              <div className="body-sm muted">
                {tab === 'unread' ? "You're all caught up." : 'No notifications yet.'}
              </div>
            </div>
          )}
          {filtered.map((n) => (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              onClick={() => openNotification(n)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openNotification(n);
                }
              }}
              style={{
                padding: '14px 18px',
                borderBottom: '1px solid var(--border-subtle)',
                cursor: 'pointer',
                display: 'flex',
                gap: 12,
                background: n.unread ? 'var(--bg-surface-2)' : 'transparent',
                transition: 'background 120ms',
              }}
            >
              <div
                aria-hidden
                style={{
                  width: 30,
                  height: 30,
                  flexShrink: 0,
                  background: 'var(--bg-surface)',
                  color: toneToColor(n.tone),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <Icon name={n.icon} size={14} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3, flex: 1 }}>
                    {n.title}
                  </div>
                  {n.unread && (
                    <span
                      aria-label="Unread"
                      style={{
                        width: 7,
                        height: 7,
                        background: 'var(--danger)',
                        borderRadius: '50%',
                        marginTop: 5,
                        flexShrink: 0,
                      }}
                    />
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.45, marginTop: 3 }}>
                  {n.body}
                </div>
                <div
                  className="row"
                  style={{ marginTop: 6, justifyContent: 'space-between' }}
                >
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.1em' }}
                  >
                    {formatRelativeTime(n.createdAt).toUpperCase()}
                  </span>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={(e) => {
                      e.stopPropagation();
                      dismiss(n.id);
                    }}
                    style={{
                      fontSize: 11,
                      color: 'var(--text-tertiary)',
                      background: 'transparent',
                      border: 0,
                      padding: 2,
                      cursor: 'pointer',
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
