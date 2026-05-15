import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { useClients } from '@/hooks/useClients';

interface ClientAutocompleteProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  id?: string;
  /** Maximum number of suggestions to show. Default 8. */
  limit?: number;
}

const MENU_GAP = 4;
const MAX_MENU_HEIGHT = 260;

/**
 * Free-text input with auto-suggest backed by the firm's client list.
 *
 * Why free-text + suggest instead of a strict picker: invoices and matters
 * sometimes get billed to one-off parties (counsel, govt entities, opposite
 * parties). Forcing a pick would push users to create disposable client
 * records. Suggestion-driven autofill gives the speed-up for repeat clients
 * without blocking the long tail.
 */
export function ClientAutocomplete({
  value,
  onChange,
  placeholder = 'Billed to (party name)',
  required,
  autoFocus,
  id,
  limit = 8,
}: ClientAutocompleteProps) {
  const { data: clients = [] } = useClients();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    const all = clients
      .map((c) => c.name)
      .filter((n, i, arr) => n && arr.indexOf(n) === i); // unique non-empty names
    if (!q) return all.slice(0, limit);
    // Prefix matches first, then substring matches.
    const prefix: string[] = [];
    const substring: string[] = [];
    for (const name of all) {
      const lower = name.toLowerCase();
      if (lower === q) continue; // hide a suggestion that exactly matches what's typed
      if (lower.startsWith(q)) prefix.push(name);
      else if (lower.includes(q)) substring.push(name);
    }
    return [...prefix, ...substring].slice(0, limit);
  }, [clients, value, limit]);

  useEffect(() => {
    setActiveIndex(0);
  }, [value, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return;
    const spaceBelow = window.innerHeight - r.bottom;
    const flipUp = spaceBelow < MAX_MENU_HEIGHT && r.top > spaceBelow;
    setMenuStyle({
      position: 'fixed',
      left: r.left,
      width: r.width,
      top: flipUp ? undefined : r.bottom + MENU_GAP,
      bottom: flipUp ? window.innerHeight - r.top + MENU_GAP : undefined,
      maxHeight: MAX_MENU_HEIGHT,
    });
  }, [open, suggestions.length]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !menuRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  useEffect(() => {
    if (!open || !menuRef.current) return;
    const el = menuRef.current.querySelector<HTMLDivElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && open && suggestions.length > 0) {
      // Only swallow Enter when a suggestion is highlighted - bare Enter
      // should still submit the surrounding form.
      const pick = suggestions[activeIndex];
      if (pick) {
        e.preventDefault();
        choose(pick);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showMenu = open && suggestions.length > 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        className="input"
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        required={required}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showMenu}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showMenu && (
        <div ref={menuRef} className="select-menu" style={menuStyle} role="listbox">
          {suggestions.map((name, i) => {
            const active = i === activeIndex;
            return (
              <div
                key={name}
                data-idx={i}
                role="option"
                aria-selected={active}
                className={`select-option${active ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(name);
                }}
                style={{ padding: '8px 12px' }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {highlight(name, value)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Bold the substring of `name` that matches `query`. */
function highlight(name: string, query: string) {
  const q = query.trim();
  if (!q) return name;
  const idx = name.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return name;
  const before = name.slice(0, idx);
  const match = name.slice(idx, idx + q.length);
  const after = name.slice(idx + q.length);
  return (
    <>
      {before}
      <strong style={{ fontWeight: 600 }}>{match}</strong>
      {after}
    </>
  );
}
