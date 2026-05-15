import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface DatePickerProps {
  /** ISO date YYYY-MM-DD or empty string for unselected. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  id?: string;
  style?: CSSProperties;
  name?: string;
  /** Earliest selectable date (inclusive), YYYY-MM-DD. */
  min?: string;
  /** Latest selectable date (inclusive), YYYY-MM-DD. */
  max?: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW    = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const PANEL_GAP = 6;
const PANEL_WIDTH = 296;
const PANEL_MAX_HEIGHT = 360;

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }
function toIso(y: number, m: number, d: number): string { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
}
function todayIso(): string {
  const t = new Date();
  return toIso(t.getFullYear(), t.getMonth(), t.getDate());
}
function formatLong(iso: string): string {
  const p = parseIso(iso);
  if (!p) return '';
  return `${pad(p.d)} ${MONTHS[p.m]?.slice(0, 3)} ${p.y}`;
}

/** Returns days for the visible month grid (always 6 rows × 7 cols), starting Monday. */
function buildMonthGrid(year: number, month: number): Array<{ y: number; m: number; d: number; outOfMonth: boolean }> {
  const first = new Date(year, month, 1);
  // Mon = 0, Sun = 6
  const dow = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - dow);
  const out: Array<{ y: number; m: number; d: number; outOfMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    out.push({
      y: d.getFullYear(), m: d.getMonth(), d: d.getDate(),
      outOfMonth: d.getMonth() !== month,
    });
  }
  return out;
}

export function DatePicker({
  value, onChange, placeholder = 'Pick a date', disabled, invalid,
  className = '', id, style, name, min, max,
}: DatePickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const reactId = useId();
  const panelId = `${id ?? reactId}-cal`;

  // The cursor month - what the panel is showing.
  const [cursor, setCursor] = useState(() => {
    const p = parseIso(value) ?? parseIso(todayIso())!;
    return { y: p.y, m: p.m };
  });

  // Sync cursor when value changes externally.
  useEffect(() => {
    const p = parseIso(value);
    if (p) setCursor({ y: p.y, m: p.m });
  }, [value]);

  const minP = min ? parseIso(min) : null;
  const maxP = max ? parseIso(max) : null;
  const grid = useMemo(() => buildMonthGrid(cursor.y, cursor.m), [cursor.y, cursor.m]);
  const today = todayIso();
  const selectedP = parseIso(value);

  const inRange = (y: number, m: number, d: number) => {
    const iso = toIso(y, m, d);
    if (minP && iso < toIso(minP.y, minP.m, minP.d)) return false;
    if (maxP && iso > toIso(maxP.y, maxP.m, maxP.d)) return false;
    return true;
  };

  // ---- positioning ---------------------------------------------------------

  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const spaceBelow = window.innerHeight - r.bottom;
    const flipUp = spaceBelow < PANEL_MAX_HEIGHT && r.top > spaceBelow;
    setPanelStyle({
      position: 'fixed',
      left: Math.min(r.left, window.innerWidth - PANEL_WIDTH - 16),
      width: PANEL_WIDTH,
      top: flipUp ? undefined : r.bottom + PANEL_GAP,
      bottom: flipUp ? window.innerHeight - r.top + PANEL_GAP : undefined,
    });
  }, [open]);

  // ---- close on outside click + escape -------------------------------------

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
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

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault();
      setOpen(true);
    }
  };

  const goPrev = () => setCursor((c) => c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 });
  const goNext = () => setCursor((c) => c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        name={name}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-invalid={invalid || undefined}
        className={`select-trigger ${className}`}
        style={style}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
      >
        <span className={value ? '' : 'muted'}>
          {value ? formatLong(value) : placeholder}
        </span>
        <span
          className="select-chevron"
          aria-hidden
          style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--text-secondary)' }}
        >
          <Icon name="calendar" size={14} />
        </span>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Choose date"
          id={panelId}
          className="select-menu datepicker-panel"
          style={{ ...panelStyle, padding: 12, zIndex: 1000 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button type="button" className="datepicker-nav" onClick={goPrev} aria-label="Previous month">‹</button>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{MONTHS[cursor.m]} {cursor.y}</span>
            <button type="button" className="datepicker-nav" onClick={goNext} aria-label="Next month">›</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {DOW.map((d) => (
              <div key={d} className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center', letterSpacing: '0.06em' }}>
                {d.charAt(0)}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {grid.map((cell) => {
              const iso = toIso(cell.y, cell.m, cell.d);
              const isSelected = !!selectedP && selectedP.y === cell.y && selectedP.m === cell.m && selectedP.d === cell.d;
              const isToday = iso === today;
              const enabled = inRange(cell.y, cell.m, cell.d);
              const cls = [
                'datepicker-day',
                cell.outOfMonth && 'is-out',
                isSelected && 'is-selected',
                isToday && !isSelected && 'is-today',
                !enabled && 'is-disabled',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={!enabled}
                  className={cls}
                  onClick={() => { onChange(iso); setOpen(false); triggerRef.current?.focus(); }}
                >
                  {cell.d}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
            <button type="button" className="btn btn-sm" onClick={() => onChange('')}>Clear</button>
            <button type="button" className="btn btn-sm" onClick={() => { onChange(today); setOpen(false); triggerRef.current?.focus(); }}>Today</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
