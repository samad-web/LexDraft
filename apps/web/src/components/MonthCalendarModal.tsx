import { useMemo, useState, type CSSProperties } from 'react';
import { Modal } from './Modal';
import { useCalendarMonth } from '@/hooks/useCalendar';
import type { CalendarHearing, CalendarMonth } from '@lexdraft/types';

// =============================================================================
// MonthCalendarModal - full-month hearings calendar opened from any dashboard.
// 7-column day grid with prev / next month navigation + "Today" shortcut.
// Click a day with hearings to drill into its cause list inside the same
// modal. Tokens follow the app design system: `.card`, `.btn`, `.eyebrow`,
// `--text-*`, `--bg-*`, `--border-*`, `--radius-*` - no new visual idioms.
// =============================================================================

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
] as const;
const WEEKDAY_HEADERS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] as const;

function todayParts(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  // month is 1-12 here; convert to 0-based for the arithmetic, back at the end.
  const idx = (month - 1) + delta;
  const ny = year + Math.floor(idx / 12);
  const nm = ((idx % 12) + 12) % 12 + 1;
  return { year: ny, month: nm };
}

interface MonthCalendarModalProps {
  open: boolean;
  onClose: () => void;
}

export function MonthCalendarModal({ open, onClose }: MonthCalendarModalProps) {
  const initial = useMemo(() => todayParts(), []);
  const [{ year, month }, setCursor] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading, isError } = useCalendarMonth(year, month, open);

  const goPrev = () => { setSelected(null); setCursor((c) => shiftMonth(c.year, c.month, -1)); };
  const goNext = () => { setSelected(null); setCursor((c) => shiftMonth(c.year, c.month, +1)); };
  const goToday = () => {
    setSelected(null);
    setCursor(todayParts());
  };

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const totalHearings = data?.hearings.length ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Calendar"
      title={monthLabel}
      description={
        isLoading
          ? 'Loading hearings...'
          : isError
            ? 'Could not load hearings for this month.'
            : `${totalHearings} ${totalHearings === 1 ? 'hearing' : 'hearings'} listed`
      }
      width={840}
    >
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-sm" onClick={goPrev} aria-label="Previous month">
          {'<'} Prev
        </button>
        <button type="button" className="btn btn-sm" onClick={goToday}>
          Today
        </button>
        <button type="button" className="btn btn-sm" onClick={goNext} aria-label="Next month">
          Next {'>'}
        </button>
      </div>

      <MonthGrid
        data={data}
        isLoading={isLoading}
        selected={selected}
        onSelect={(iso) => setSelected((curr) => (curr === iso ? null : iso))}
      />

      <DayHearingsPanel
        data={data}
        selected={selected}
      />
    </Modal>
  );
}

// ------- Month grid -----------------------------------------------------------

function MonthGrid({
  data,
  isLoading,
  selected,
  onSelect,
}: {
  data: CalendarMonth | undefined;
  isLoading: boolean;
  selected: string | null;
  onSelect: (iso: string) => void;
}) {
  // Leading blanks so the 1st of the month lands in the correct column.
  const leading = data && data.days[0] ? data.days[0].weekdayIndex : 0;

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 6,
  };

  // Render placeholder cells with the same dimensions as real day cells so
  // the modal's vertical extent doesn't jump when data arrives.
  const showSkeleton = isLoading && !data;

  return (
    <div>
      <div style={gridStyle}>
        {WEEKDAY_HEADERS.map((w) => (
          <div
            key={w}
            className="mono"
            style={{
              fontSize: 11,
              letterSpacing: '0.14em',
              color: 'var(--text-tertiary)',
              textAlign: 'center',
              padding: '4px 0',
              textTransform: 'uppercase',
            }}
          >
            {w}
          </div>
        ))}
      </div>
      <div style={gridStyle}>
        {showSkeleton && Array.from({ length: 35 }).map((_, i) => (
          <div
            key={`skel-${i}`}
            aria-hidden
            style={{
              minHeight: 64,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              opacity: 0.5,
            }}
          />
        ))}
        {!showSkeleton && Array.from({ length: leading }).map((_, i) => (
          <div key={`pad-${i}`} aria-hidden style={{ minHeight: 64 }} />
        ))}
        {!showSkeleton && (data?.days ?? []).map((d) => {
          const isSelected = d.date === selected;
          const tone =
            d.isToday
              ? { bg: 'var(--text-primary)', fg: 'var(--bg-base)', border: 'var(--text-primary)' }
              : isSelected
                ? { bg: 'var(--bg-surface-2)', fg: 'var(--text-primary)', border: 'var(--text-primary)' }
                : { bg: 'var(--bg-surface)',  fg: 'var(--text-primary)', border: 'var(--border-subtle)' };
          const hasHearings = d.count > 0;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => onSelect(d.date)}
              aria-pressed={isSelected}
              aria-label={`${d.date}${d.count ? `, ${d.count} ${d.count === 1 ? 'hearing' : 'hearings'}` : ''}`}
              style={{
                appearance: 'none',
                cursor: 'pointer',
                background: tone.bg,
                color: tone.fg,
                border: `1px solid ${tone.border}`,
                borderRadius: 'var(--radius-md)',
                padding: '10px 8px',
                minHeight: 60,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 6,
                transition: 'background 120ms, border-color 120ms',
                textAlign: 'left',
              }}
            >
              <span
                className="mono tabular"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: 0,
                }}
              >
                {Number(d.date.slice(8, 10))}
              </span>
              {hasHearings && (
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: d.isToday ? 'var(--bg-base)' : 'var(--text-secondary)',
                  }}
                >
                  {d.count} {d.count === 1 ? 'hearing' : 'hearings'}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ------- Day drilldown --------------------------------------------------------

function DayHearingsPanel({
  data,
  selected,
}: {
  data: CalendarMonth | undefined;
  selected: string | null;
}) {
  const hearings = useMemo<CalendarHearing[]>(() => {
    if (!data || !selected) return [];
    return data.hearings.filter((h) => h.date === selected);
  }, [data, selected]);

  if (!selected) {
    return (
      <div
        className="body-sm muted"
        style={{
          border: '1px dashed var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: 16,
          textAlign: 'center',
        }}
      >
        Select a day to see its cause list.
      </div>
    );
  }

  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: 16,
        background: 'var(--bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div className="row" style={{ alignItems: 'baseline', gap: 12 }}>
        <span className="heading-md">{selected}</span>
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)' }}>
          {hearings.length} {hearings.length === 1 ? 'HEARING' : 'HEARINGS'}
        </span>
      </div>

      {hearings.length === 0 ? (
        <p className="body-sm muted" style={{ margin: 0 }}>
          No hearings on this day.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {hearings.map((h, i) => (
            <li
              key={h.id ?? `${h.date}-${i}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '70px 1fr',
                gap: 12,
                alignItems: 'center',
                padding: '8px 0',
                borderBottom: i < hearings.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}
            >
              <span className="mono tabular" style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                {h.time || '--:--'}
              </span>
              <div>
                <div className="body-md" style={{ marginBottom: 2 }}>
                  <em className="case-name">{h.case}</em>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className="body-sm">{h.purpose}</span>
                  <span style={{ width: 3, height: 3, background: 'var(--text-tertiary)', borderRadius: '50%' }} />
                  <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)' }}>
                    {h.court.toUpperCase()}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
