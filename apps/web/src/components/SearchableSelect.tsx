import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

export interface SearchableOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Plaintext used for filtering. Defaults to `String(label)`. */
  search?: string;
  hint?: string;
  disabled?: boolean;
}

interface SearchableSelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SearchableOption<T>>;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  style?: CSSProperties;
  /** Width of the popover; defaults to the input width. */
  menuWidth?: number;
}

const MENU_GAP = 6;
const MAX_MENU_HEIGHT = 320;

function optionText<T extends string>(opt: SearchableOption<T>): string {
  return opt.search ?? (typeof opt.label === 'string' ? opt.label : String(opt.value));
}

/**
 * Combobox: the input itself is the search field. Focusing opens the menu;
 * typing filters; clicking or pressing Enter on a row selects. Blurring
 * without a fresh selection restores the previously-selected label so the
 * field never sits in an invalid state.
 */
export function SearchableSelect<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Search…',
  disabled,
  invalid,
  id,
  className = '',
  style,
  menuWidth,
}: SearchableSelectProps<T>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const reactId = useId();
  const listId = `${id ?? reactId}-list`;

  const selected = options.find((o) => o.value === value);
  const selectedLabel = selected ? optionText(selected) : '';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const text = optionText(o).toLowerCase();
      return text.includes(q) || o.value.toLowerCase().includes(q);
    });
  }, [options, query]);

  // Keep highlight valid as the filter narrows.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

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
  }, [open, menuWidth, query]);

  // ---- close on outside click ---------------------------------------------
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !menuRef.current?.contains(t)) {
        setOpen(false);
        setQuery('');
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
        inputRef.current?.blur();
      }
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Keep the highlighted row in view during keyboard nav.
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const el = menuRef.current.querySelector<HTMLDivElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const choose = (opt: SearchableOption<T>) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[activeIndex];
      if (opt) choose(opt);
    }
  };

  return (
    <div ref={wrapRef} className={className} style={{ position: 'relative', ...style }}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={invalid || undefined}
        className="input"
        placeholder={placeholder}
        // When the field is open we show the user's query; when closed we show
        // the canonical label of the current value so the field always reads
        // truthfully even after focus moves elsewhere.
        value={open ? query : selectedLabel}
        onChange={(e) => {
          if (!open) setOpen(true);
          setQuery(e.target.value);
        }}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onKeyDown={onKeyDown}
        style={{ paddingRight: 32 }}
      />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          right: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--text-tertiary)',
          fontSize: 11,
          pointerEvents: 'none',
        }}
      >
        ▾
      </span>

      {open && (
        <div ref={menuRef} className="select-menu" style={menuStyle} role="listbox" id={listId}>
          {filtered.length === 0 ? (
            <div
              style={{
                padding: '14px 12px',
                color: 'var(--text-tertiary)',
                fontSize: 13,
                textAlign: 'center',
              }}
            >
              No matches.
            </div>
          ) : (
            filtered.map((opt, i) => {
              const active = i === activeIndex;
              const isSelected = opt.value === value;
              return (
                <div
                  key={opt.value}
                  data-idx={i}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled || undefined}
                  className={[
                    'select-option',
                    active && 'is-active',
                    isSelected && 'is-selected',
                    opt.disabled && 'is-disabled',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(opt);
                  }}
                  style={{ padding: '8px 12px' }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {opt.label}
                  </span>
                  {opt.hint && (
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 8 }}
                    >
                      {opt.hint}
                    </span>
                  )}
                  {isSelected && <span aria-hidden style={{ marginLeft: 8 }}>✓</span>}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
