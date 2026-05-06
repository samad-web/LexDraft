import {
  useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode,
} from 'react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Optional small right-aligned hint text (e.g. mono short code). */
  hint?: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SelectOption<T>>;
  placeholder?: string;
  disabled?: boolean;
  /** Same `aria-invalid` as native input — borders go red. */
  invalid?: boolean;
  className?: string;
  id?: string;
  style?: CSSProperties;
  name?: string;
  /** Width of the popover; defaults to the trigger width. */
  menuWidth?: number;
}

const MENU_VPAD = 6;
const MENU_GAP  = 6;
const MAX_MENU_HEIGHT = 280;

/** Custom-styled select that renders a popover menu matching the app's
 *  monochrome system. Click-outside, keyboard nav, and flip-on-overflow
 *  are all handled inline — no external deps. */
export function Select<T extends string = string>({
  value, onChange, options, placeholder = 'Select…',
  disabled, invalid, className = '', id, style, name, menuWidth,
}: SelectProps<T>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(() => {
    const i = options.findIndex((o) => o.value === value);
    return i === -1 ? 0 : i;
  });
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const reactId = useId();
  const listId = `${id ?? reactId}-list`;

  const selected = options.find((o) => o.value === value);

  // ---- positioning ---------------------------------------------------------

  useLayoutEffect(() => {
    if (!open) return;
    const r = triggerRef.current?.getBoundingClientRect();
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
  }, [open, menuWidth]);

  // ---- close on outside click + escape -------------------------------------

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // ---- keyboard nav inside trigger -----------------------------------------

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(options.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const opt = options[activeIndex];
        if (opt && !opt.disabled) {
          onChange(opt.value);
          setOpen(false);
        }
      }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        name={name}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={invalid || undefined}
        className={`select-trigger ${className}`}
        style={style}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
      >
        <span className={selected ? '' : 'muted'}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="select-chevron" aria-hidden>▾</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          id={listId}
          tabIndex={-1}
          className="select-menu"
          style={menuStyle}
        >
          {options.map((opt, i) => {
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
                  e.preventDefault();
                  if (opt.disabled) return;
                  onChange(opt.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                style={{ padding: `${MENU_VPAD + 2}px 12px` }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {opt.label}
                </span>
                {opt.hint && (
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                    {opt.hint}
                  </span>
                )}
                {isSelected && <span aria-hidden style={{ marginLeft: 8 }}>✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
