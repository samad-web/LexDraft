import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// =============================================================================
// Combobox - free-text input with a themed dropdown of suggestions. Behaves
// like a Select visually, but lets the user type any value not in the list.
// Used for fields like COURT and MATTER where we want to nudge users toward
// known values while still permitting one-off entries.
//
// The menu portals to document.body so a transformed/scaled ancestor (e.g. the
// app Modal which animates with `transform: scale(...)`) can't capture our
// `position: fixed` containing block and offset the popover.
// =============================================================================

export interface ComboboxOption {
  value: string;
  /** Optional render label (defaults to `value`). */
  label?: ReactNode;
  /** Small right-aligned hint (e.g. court for a matter title). */
  hint?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<ComboboxOption>;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  name?: string;
  style?: CSSProperties;
  autoFocus?: boolean;
  /** Width of the popover; defaults to the trigger width. */
  menuWidth?: number;
  /** Optional empty-state row. Defaults to "No matches". */
  emptyMessage?: ReactNode;
}

const MENU_GAP = 6;
const MAX_MENU_HEIGHT = 280;

export function Combobox({
  value, onChange, options, placeholder = 'Start typing…',
  disabled, invalid, required, className = '', id, name, style, autoFocus,
  menuWidth, emptyMessage = 'No matches - press Enter to keep what you typed.',
}: ComboboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const reactId = useId();
  const listId = `${id ?? reactId}-list`;

  // Filter options against the current input value (case-insensitive substring).
  // If the input exactly matches an option, we still show the full list so the
  // user can pick a neighbour.
  const filtered = useMemo<ComboboxOption[]>(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options.slice();
    const exact = options.find((o) => o.value.toLowerCase() === q);
    if (exact) return options.slice();
    return options.filter((o) =>
      o.value.toLowerCase().includes(q)
      || (typeof o.label === 'string' && o.label.toLowerCase().includes(q))
      || (typeof o.hint === 'string' && o.hint.toLowerCase().includes(q)),
    );
  }, [value, options]);

  // Reset active index when the filter changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [filtered.length, value]);

  // ---- positioning ---------------------------------------------------------

  useLayoutEffect(() => {
    if (!open) return;
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return;
    const w = menuWidth ?? r.width;
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const flipUp = spaceBelow < MAX_MENU_HEIGHT && spaceAbove > spaceBelow;
    setMenuStyle({
      position: 'fixed',
      left: r.left,
      width: w,
      top: flipUp ? undefined : r.bottom + MENU_GAP,
      bottom: flipUp ? window.innerHeight - r.top + MENU_GAP : undefined,
      maxHeight: MAX_MENU_HEIGHT,
    });
  }, [open, menuWidth, filtered.length]);

  // ---- close on outside click + escape -------------------------------------

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!inputRef.current?.contains(t) && !menuRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const selectOption = (opt: ComboboxOption) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      if (open && filtered[activeIndex]) {
        e.preventDefault();
        selectOption(filtered[activeIndex]);
      }
      // If menu is closed (or there are no matches), let the form submit.
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };

  return (
    <div style={{ position: 'relative', ...style }} className={className}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        className="input"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={invalid || undefined}
        aria-autocomplete="list"
        autoComplete="off"
        style={{ paddingRight: 36 }}
      />
      <span
        aria-hidden
        className="select-chevron"
        style={{
          position: 'absolute',
          right: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 11,
          color: 'var(--text-secondary)',
          pointerEvents: 'none',
        }}
      >
        ▾
      </span>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          id={listId}
          tabIndex={-1}
          className="select-menu"
          style={{ ...menuStyle, zIndex: 1000 }}
        >
          {filtered.length === 0 ? (
            <div
              className="select-option is-disabled"
              style={{ padding: '8px 12px', cursor: 'default', color: 'var(--text-tertiary)' }}
            >
              {emptyMessage}
            </div>
          ) : (
            filtered.map((opt, i) => {
              const active = i === activeIndex;
              const isSelected = opt.value === value;
              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled || undefined}
                  className={[
                    'select-option',
                    active && 'is-active',
                    isSelected && 'is-selected',
                    opt.disabled && 'is-disabled',
                  ].filter(Boolean).join(' ')}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => {
                    // Prevent the input from blurring before our click fires.
                    e.preventDefault();
                    selectOption(opt);
                  }}
                  style={{ padding: '8px 12px' }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {opt.label ?? opt.value}
                  </span>
                  {opt.hint && (
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                      {opt.hint}
                    </span>
                  )}
                  {isSelected && <span aria-hidden style={{ marginLeft: 8 }}>✓</span>}
                </div>
              );
            })
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
