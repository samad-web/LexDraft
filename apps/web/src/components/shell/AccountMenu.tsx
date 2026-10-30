import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { useSignOut } from '@/hooks/useAuth';

/**
 * The signed-in advocate at the foot of the sidebar. Opens a small menu with
 * settings, plan, theme and sign out (sign out used to sit in the topbar).
 */
export function AccountMenu({ name, detail, initials }: { name: string; detail: string; initials: string }) {
  const navigate = useNavigate();
  const signOut = useSignOut();
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <div className="account" ref={ref}>
      {open && (
        <div className="account-menu" role="menu">
          <div className="account-menu-head">
            <div className="account-menu-name">{name}</div>
            {detail && <div className="account-menu-detail">{detail}</div>}
          </div>
          <button type="button" role="menuitem" className="account-menu-item" onClick={() => go('/app/settings')}>
            <Icon name="settings" size={15} /> Settings
          </button>
          <button type="button" role="menuitem" className="account-menu-item" onClick={() => go('/app/billing')}>
            <Icon name="sparkle" size={15} /> Plan &amp; billing
          </button>
          <button type="button" role="menuitem" className="account-menu-item" onClick={toggleTheme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <div className="account-menu-rule" />
          <button
            type="button"
            role="menuitem"
            className="account-menu-item"
            onClick={() => {
              setOpen(false);
              signOut();
              navigate('/');
            }}
          >
            <Icon name="logout" size={15} /> Sign out
          </button>
        </div>
      )}
      <button
        type="button"
        className={`account-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${name}`}
      >
        <span className="avatar account-avatar">{initials}</span>
        <span className="account-text">
          <span className="account-name">{name}</span>
          {detail && <span className="account-detail">{detail}</span>}
        </span>
        <Icon name="chevronD" size={14} className="account-chev" />
      </button>
    </div>
  );
}
