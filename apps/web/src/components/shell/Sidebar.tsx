import { useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { NAV_GROUPS } from './nav-config';
import { useAuthStore } from '@/store/auth';
import { useNavHighlighter } from '@/hooks/useNavHighlighter';

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const initials = (user?.name || 'AS').split(' ').map((s) => s[0]).slice(0, 2).join('');
  const navRef = useRef<HTMLElement>(null);
  const hl = useNavHighlighter(navRef);

  return (
    <aside className="sidebar">
      <div className="wordmark">
        <span className="wordmark-mark" aria-hidden />
        <span className="wordmark-full">LexDraft</span>
      </div>

      {user?.isSuperadmin && (
        <div style={{ padding: '0 20px 8px' }}>
          <span className="badge badge-vermillion mono" style={{ fontSize: 10 }}>
            SUPERADMIN
          </span>
        </div>
      )}

      <div style={{ padding: '8px 20px 12px' }} className="wordmark-full">
        <div className="row" style={{ gap: 10 }}>
          <div className="avatar">{initials}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {user?.name || 'Aarav Sharma'}
            </div>
            <div className="mono" style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>
              {user?.role || 'Solo Advocate'}
            </div>
          </div>
        </div>
      </div>

      <nav ref={navRef} style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        <div
          className="nav-highlighter"
          aria-hidden
          style={{
            transform: `translateY(${hl.top}px)`,
            height: hl.height,
            opacity: hl.visible ? 1 : 0,
          }}
        />
        {NAV_GROUPS.map((g) => (
          <div key={g.title} className="nav-section">
            <div className="nav-group-title">{g.title}</div>
            {g.items.map((item) => {
              const active = location.pathname.startsWith(item.to);
              return (
                <NavLink
                  key={item.id}
                  to={item.to}
                  className={`nav-item${active ? ' active' : ''}`}
                  end={false}
                >
                  <Icon name={item.icon} className="nav-icon" />
                  <span className="nav-label" style={{ flex: 1 }}>
                    {item.label}
                  </span>
                  {item.badge && (
                    <span
                      className="mono nav-label"
                      style={{ fontSize: 9, color: 'var(--text-tertiary)', letterSpacing: '0.1em' }}
                    >
                      {item.badge}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="quota">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            AI DOCUMENTS
          </span>
          <span className="mono" style={{ fontSize: 11 }}>47 / 100</span>
        </div>
        <div className="quota-track">
          <div className="quota-fill" style={{ width: '47%' }} />
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
          Generated · this month
        </div>
      </div>
    </aside>
  );
}
