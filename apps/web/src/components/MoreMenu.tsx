import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@lexdraft/ui';

export interface MoreMenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  disabled?: boolean;
  /** Tooltip, e.g. why an item is disabled. */
  title?: string;
}

/**
 * "More ▾" overflow menu for secondary page actions, so a header can keep
 * one or two visible buttons. Closes on outside click, Escape, or selection.
 */
export function MoreMenu({ items, label = 'More' }: { items: MoreMenuItem[]; label?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="more-menu" ref={ref}>
      <button
        type="button"
        className="btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label} <Icon name="chevronD" size={14} />
      </button>
      {open && (
        <div className="more-menu-list" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className="more-menu-item"
              disabled={it.disabled}
              title={it.title}
              onClick={() => { setOpen(false); it.onSelect(); }}
            >
              {it.icon && <Icon name={it.icon} size={14} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
