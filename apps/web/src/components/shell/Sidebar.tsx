import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { NAV_GROUPS } from './nav-config';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { useNavHighlighter } from '@/hooks/useNavHighlighter';
import { useMyUsage } from '@/hooks/useMyUsage';
import { useMeFeatures } from '@/hooks/useFirmAdmin';

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const initials = (user?.name || 'AS').split(' ').map((s) => s[0]).slice(0, 2).join('');
  const navRef = useRef<HTMLElement>(null);
  const hl = useNavHighlighter(navRef);
  const usage = useMyUsage();
  const meFeatures = useMeFeatures();
  const granted = meFeatures.data?.features ?? [];
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  // Close the drawer on route change (mobile UX).
  useEffect(() => {
    if (sidebarOpen) toggleSidebar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Close on Esc.
  useEffect(() => {
    if (!sidebarOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleSidebar(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sidebarOpen, toggleSidebar]);

  return (
    <>
      {sidebarOpen && (
        <div
          className="sidebar-scrim"
          aria-hidden
          onClick={() => toggleSidebar(false)}
        />
      )}
      <aside className={`sidebar${sidebarOpen ? ' is-open' : ''}`}>
        <div className="wordmark">
          <span className="wordmark-mark" aria-hidden />
          <span className="wordmark-full">LexDraft</span>
          <button
            type="button"
            className="btn btn-ghost sidebar-close"
            onClick={() => toggleSidebar(false)}
            aria-label="Close navigation menu"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {user?.isSuperadmin && (
          <div style={{ padding: '0 20px 8px' }}>
            <span className="badge badge-vermillion mono" style={{ fontSize: 10 }}>
              SUPERADMIN
            </span>
          </div>
        )}

        {!user?.isSuperadmin && user?.plan && (
          <div style={{ padding: '0 20px 8px' }}>
            <span
              className="badge mono"
              style={{ fontSize: 10, letterSpacing: '0.12em' }}
              title={`${user.plan} plan`}
            >
              {user.plan.toUpperCase()}
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
          {NAV_GROUPS.map((g) => {
            const visibleItems = g.items.filter(
              (item) => !item.requiresFeature || granted.includes(item.requiresFeature),
            );
            if (visibleItems.length === 0) return null;
            return (
              <div key={g.title} className="nav-section">
                <div className="nav-group-title">{g.title}</div>
                {visibleItems.map((item) => {
                  // Exact match OR /-bounded prefix. Plain `startsWith`
                  // would highlight "Review" for /app/review-queue (because
                  // /app/review-queue startsWith /app/review). Same family
                  // catches /app/cases vs /app/cases/:id correctly.
                  const path = location.pathname;
                  const active = path === item.to || path.startsWith(item.to + '/');
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
            );
          })}
        </nav>

        <div className="quota">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
              AI DOCUMENTS
            </span>
            <span className="mono" style={{ fontSize: 11 }}>
              {usage.isLoading || !usage.data
                ? '- / -'
                : usage.data.aiDocuments.limit == null
                  ? `${usage.data.aiDocuments.used} · Unlimited`
                  : `${usage.data.aiDocuments.used} / ${usage.data.aiDocuments.limit}`}
            </span>
          </div>
          {usage.data && usage.data.aiDocuments.limit != null && (
            <div className="quota-track">
              <div
                className="quota-fill"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round((usage.data.aiDocuments.used / usage.data.aiDocuments.limit) * 100),
                  )}%`,
                }}
              />
            </div>
          )}
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            {usage.data?.aiDocuments.limit == null && usage.data
              ? 'Generated · this month'
              : usage.data
                ? `${Math.max(0, (usage.data.aiDocuments.limit ?? 0) - usage.data.aiDocuments.used)} remaining · this month`
                : 'Generated · this month'}
          </div>
        </div>
      </aside>
    </>
  );
}
