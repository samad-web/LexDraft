import { useState } from 'react';
import { Icon, type IconName } from '@lexdraft/ui';

interface Notification {
  id: string;
  icon: IconName;
  tone: 'cobalt' | 'sage' | 'vermillion' | 'amber';
  title: string;
  body: string;
  time: string;
  unread: boolean;
  view: string;
}

const SAMPLE: Notification[] = [
  { id: 'n1', icon: 'calendar', tone: 'cobalt', title: 'Hearing tomorrow · 11:00 AM', body: 'O.S. 1247/2025 - Mehta v. Skyline Constructions, Bengaluru City Civil Court, Court Hall 4', time: '2h ago', unread: true, view: 'cases' },
  { id: 'n2', icon: 'draft', tone: 'sage', title: 'AI draft ready for review', body: 'Legal Notice u/s 138 NI Act · Mehta Enterprises v. Verma - generated in 18 seconds', time: '4h ago', unread: true, view: 'draft' },
  { id: 'n3', icon: 'invoices', tone: 'sage', title: 'Payment received · ₹84,000', body: 'INV-2026-018 paid by Coastal Estates Pvt Ltd via NEFT (UTR 4823910)', time: 'Today, 9:42 AM', unread: true, view: 'invoices' },
  { id: 'n4', icon: 'limitation', tone: 'vermillion', title: 'Limitation expiring in 11 days', body: 'Filing of execution petition · Decree dated 14 Aug 2023 · Karthik Rao matter', time: 'Yesterday', unread: false, view: 'limitation' },
  { id: 'n5', icon: 'documents', tone: 'cobalt', title: 'Vakalatnama signed by client', body: 'Rohan Mehta - High Court of Karnataka · e-signed via Aadhaar OTP', time: 'Yesterday', unread: false, view: 'documents' },
  { id: 'n6', icon: 'leads', tone: 'amber', title: 'New enquiry · ₹35,000 estimated', body: 'Tarun Bhalla - referred by Adv. Kumar · cheque bounce, ₹2.4L', time: '2 days ago', unread: false, view: 'leads' },
];

export function NotificationPanel({
  onClose,
  onNav,
}: {
  onClose: () => void;
  onNav: (view: string) => void;
}) {
  const [items, setItems] = useState(SAMPLE);
  const markAllRead = () => setItems((p) => p.map((n) => ({ ...n, unread: false })));

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div
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
            <div style={{ fontSize: 14, fontWeight: 500, marginTop: 2 }}>Inbox</div>
          </div>
          <button className="btn btn-sm btn-ghost mono" style={{ fontSize: 10, letterSpacing: '0.12em' }} onClick={markAllRead}>
            MARK ALL READ
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {items.map((n) => (
            <div
              key={n.id}
              onClick={() => {
                onNav(n.view);
                onClose();
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
                style={{
                  width: 30,
                  height: 30,
                  flexShrink: 0,
                  background: 'var(--bg-surface)',
                  color: `var(--${n.tone === 'cobalt' ? 'info' : n.tone === 'sage' ? 'success' : n.tone === 'amber' ? 'warning' : 'danger'})`,
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
                  <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3, flex: 1 }}>{n.title}</div>
                  {n.unread && (
                    <span
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
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.1em', marginTop: 6 }}>
                  {n.time.toUpperCase()}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
