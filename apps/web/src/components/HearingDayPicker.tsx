import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@lexdraft/ui';
import { useCalendarMonth } from '@/hooks/useCalendar';

// =============================================================================
// HearingDayPicker — a popover month calendar (same interaction model as the
// shared DatePicker) that overlays each day with case activity (from
// /hearings/month) and recommends the best day to be reminded. It opens on
// demand from a compact trigger, so it drops into a normal form field.
//   - days with hearings show a small count,
//   - filings / judgments on a day are marked so case history is visible,
//   - the single best day to prepare (good lead time before the hearing, not a
//     weekend, not already busy) is highlighted and pre-selected,
//   - the hearing day itself is shown but not selectable (a reminder on the day
//     of the hearing is pointless), and weekends read like weekdays.
// Styling reuses the app's datepicker-* / select-* classes + .hday-* helpers
// (globals.css) so it sits in the monochrome theme.
// =============================================================================

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Working days of lead time we aim to give before a hearing for prep + sending
 *  out notifications/messages. The recommended day targets this buffer. */
const IDEAL_LEAD_WORKING_DAYS = 2;

type DayKind = 'judgment' | 'filing' | 'hearing';

/** Classify a hearing purpose into the activity we surface on the calendar so a
 *  filing or judgment given on a day is noted distinctly from a plain hearing. */
function classifyPurpose(purpose: string): DayKind {
  const p = (purpose || '').toLowerCase();
  if (/judg|verdict|dispos|pronounce|order/.test(p)) return 'judgment';
  if (/fil|petition|affidavit|rejoinder|repl|written statement|submiss|plaint|application|vakalat/.test(p)) return 'filing';
  return 'hearing';
}

const PANEL_GAP = 6;
const PANEL_WIDTH = 300;
const PANEL_MAX_HEIGHT = 380;

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
function dowOf(iso: string): number {
  const p = parseIso(iso);
  if (!p) return 0;
  return new Date(p.y, p.m, p.d).getDay(); // Sun=0 … Sat=6
}
function isWeekendIso(iso: string): boolean {
  const d = dowOf(iso);
  return d === 0 || d === 6;
}
function addDaysIso(iso: string, n: number): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const d = new Date(p.y, p.m, p.d + n);
  return toIso(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Choose the best day to be reminded: a working day that lands ~IDEAL_LEAD
 * working days before the hearing (enough runway to prepare and send out
 * notifications), avoiding weekends and days that already carry hearings. Scans
 * the window [minIso, hearingIso) and scores each candidate; the closest-to-
 * hearing day with the lowest penalty wins. Returns null when there's no room.
 */
function recommendDay(minIso: string, hearingIso: string | undefined, countByIso: Map<string, number>): string | null {
  if (!hearingIso || hearingIso <= minIso) return null;
  let best: string | null = null;
  let bestScore = Infinity;
  let workingLead = 0; // working days strictly between the candidate and the hearing
  for (let iso = addDaysIso(hearingIso, -1); iso >= minIso; iso = addDaysIso(iso, -1)) {
    const weekend = isWeekendIso(iso);
    const busy = (countByIso.get(iso) ?? 0) > 0;
    let score = Math.abs(workingLead - IDEAL_LEAD_WORKING_DAYS);
    if (weekend) score += 10;   // courts/offices shut — poor day to prepare
    if (busy) score += 5;       // already has a hearing — keep it clear
    if (score < bestScore) { bestScore = score; best = iso; }
    if (!weekend) workingLead += 1;
  }
  return best;
}

/** 6×7 grid starting Monday, like the shared DatePicker. */
function buildMonthGrid(year: number, month: number): Array<{ y: number; m: number; d: number; outOfMonth: boolean }> {
  const first = new Date(year, month, 1);
  const dow = (first.getDay() + 6) % 7; // Mon = 0
  const start = new Date(year, month, 1 - dow);
  const out: Array<{ y: number; m: number; d: number; outOfMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    out.push({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), outOfMonth: d.getMonth() !== month });
  }
  return out;
}

export interface HearingDayPickerProps {
  /** Selected day, ISO YYYY-MM-DD, or '' for none. */
  value: string;
  onChange: (iso: string) => void;
  /** Earliest selectable day (inclusive). Defaults to today. */
  min?: string;
  /** Latest selectable day (inclusive). Open-ended when omitted. */
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
}

export function HearingDayPicker({ value, onChange, min, max, disabled, placeholder = 'Pick a date', id }: HearingDayPickerProps) {
  const today = todayIso();
  const minIso = min ?? today;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const reactId = useId();
  const panelId = `${id ?? reactId}-cal`;

  const [cursor, setCursor] = useState(() => {
    const p = parseIso(value) ?? parseIso(today)!;
    return { y: p.y, m: p.m };
  });
  useEffect(() => {
    const p = parseIso(value);
    if (p) setCursor({ y: p.y, m: p.m });
  }, [value]);

  // Per-day case activity for the visible month — only fetched while open.
  const month = useCalendarMonth(cursor.y, cursor.m + 1, open);
  const countByIso = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of month.data?.days ?? []) map.set(d.date, d.count);
    return map;
  }, [month.data]);
  // Classify each day's hearings so filings / judgments are noted distinctly.
  const kindByIso = useMemo(() => {
    const map = new Map<string, Set<DayKind>>();
    for (const h of month.data?.hearings ?? []) {
      const set = map.get(h.date) ?? new Set<DayKind>();
      set.add(classifyPurpose(h.purpose));
      map.set(h.date, set);
    }
    return map;
  }, [month.data]);

  // The best day to be reminded (working day, good lead time, not busy). Counts
  // refine it once the month loads; before that it's still a sound working-day
  // pick, so we can recommend immediately.
  const recommendedIso = useMemo(() => recommendDay(minIso, max, countByIso), [minIso, max, countByIso]);

  // Default the field to the recommended day once, when it starts empty — the
  // picker actively chooses the best day rather than leaving it blank. We don't
  // re-apply after that, so an explicit Clear sticks.
  const didAutoPick = useRef(false);
  useEffect(() => {
    if (didAutoPick.current || disabled || value || !recommendedIso) return;
    didAutoPick.current = true;
    onChange(recommendedIso);
  }, [disabled, value, recommendedIso, onChange]);

  const grid = useMemo(() => buildMonthGrid(cursor.y, cursor.m), [cursor.y, cursor.m]);
  const selectedP = parseIso(value);

  // ---- positioning (mirrors the shared DatePicker) -------------------------
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

  const goPrev = () => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }));
  const goNext = () => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }));
  const pick = (iso: string) => { onChange(iso); setOpen(false); triggerRef.current?.focus(); };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        className="select-trigger"
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
      >
        <span className={value ? '' : 'muted'}>{value ? formatLong(value) : placeholder}</span>
        <span className="select-chevron" aria-hidden style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--text-secondary)' }}>
          <Icon name="calendar" size={14} />
        </span>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Choose a day"
          id={panelId}
          className="select-menu datepicker-panel"
          style={{ ...panelStyle, padding: 'var(--space-3)', zIndex: 1000 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
            <button type="button" className="datepicker-nav" onClick={goPrev} aria-label="Previous month">‹</button>
            <span className="body-sm" style={{ fontWeight: 500 }}>{MONTHS[cursor.m]} {cursor.y}</span>
            <button type="button" className="datepicker-nav" onClick={goNext} aria-label="Next month">›</button>
          </div>

          <div className="hday-grid" style={{ marginBottom: 4 }}>
            {DOW.map((d) => <div key={d} className="hday-dow">{d.charAt(0)}</div>)}
          </div>

          <div className="hday-grid">
            {grid.map((cell) => {
              const iso = toIso(cell.y, cell.m, cell.d);
              const isSelected = !!selectedP && selectedP.y === cell.y && selectedP.m === cell.m && selectedP.d === cell.d;
              const isToday = iso === today;
              // The hearing day (max) is shown but never selectable — being
              // reminded on the day of the hearing is pointless.
              const isHearingDay = !!max && iso === max;
              const outOfRange = iso < minIso || (!!max && iso >= max);
              const count = countByIso.get(iso) ?? 0;
              const kinds = kindByIso.get(iso);
              const isFree = !cell.outOfMonth && !outOfRange && count === 0;
              const isRecommended = !cell.outOfMonth && !outOfRange && iso === recommendedIso;
              // One marker dot per day: judgment ▸ filing ▸ hearing ▸ free.
              const mark = kinds?.has('judgment') ? 'judgment'
                : kinds?.has('filing') ? 'filing'
                : count > 0 ? 'hearing'
                : isFree ? 'free' : null;
              const cls = [
                'datepicker-day', 'hday-day',
                cell.outOfMonth && 'is-out',
                isSelected && 'is-selected',
                isToday && !isSelected && 'is-today',
                isHearingDay && 'hday-hearing-day',
                isRecommended && !isSelected && 'hday-best',
                outOfRange && !isHearingDay && 'is-disabled',
                mark && `hday-mark is-${mark}`,
              ].filter(Boolean).join(' ');
              const title = isHearingDay ? 'Hearing day — no reminder needed'
                : kinds && kinds.size > 0 ? [...kinds].join(', ') + ` (${count})`
                : isRecommended ? 'Best day to prepare'
                : isFree ? 'Free day' : undefined;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={outOfRange}
                  className={cls}
                  onClick={() => pick(iso)}
                  title={title}
                >
                  {cell.d}
                  {count > 0 && <span className="hday-count" aria-hidden>{count}</span>}
                </button>
              );
            })}
          </div>

          <div className="hday-legend">
            <span><span className="hday-legend-dot is-best" />best day</span>
            <span><span className="hday-legend-dot is-filing" />filing</span>
            <span><span className="hday-legend-dot is-judgment" />judgment</span>
            {recommendedIso && (
              <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => pick(recommendedIso)}>Best day</button>
            )}
            {value && <button type="button" className="btn btn-sm" onClick={() => { onChange(''); setOpen(false); }}>Clear</button>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
