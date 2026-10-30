import { useMemo, useState } from 'react';
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
          <span aria-hidden>‹</span> Prev
        </button>
        <button type="button" className="btn btn-sm" onClick={goToday}>
          Today
        </button>
        <button type="button" className="btn btn-sm" onClick={goNext} aria-label="Next month">
          Next <span aria-hidden>›</span>
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

/// ------- Month grid -----------------------------------------------------------

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
  const today = new Intl.DateTimeFormat('en-CA').format(new Date());

  // Render placeholder cells with the same dimensions as real day cells so
  // the modal's vertical extent doesn't jump when data arrives.
  const showSkeleton = isLoading && !data;

  return (
    <div className="ct-cal ct-month ct-mcal">
      <div className="ct-cal-grid">
        {WEEKDAY_HEADERS.map((w, i) => (
          <div key={w} className={`ct-cal-wd${i >= 5 ? ' is-weekend' : ''}`}>{w}</div>
        ))}
      </div>
      <div className="ct-cal-grid">
        {showSkeleton && Array.from({ length: 35 }).map((_, i) => (
          <span key={`skel-${i}`} aria-hidden className="ct-skel ct-cal-pad" />
        ))}
        {!showSkeleton && Array.from({ length: leading }).map((_, i) => (
          <div key={`pad-${i}`} aria-hidden className="ct-cal-pad" />
        ))}
        {!showSkeleton && (data?.days ?? []).map((d) => {
          const isSelected = d.date === selected;
          const hasHearings = d.count > 0;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => onSelect(d.date)}
              aria-pressed={isSelected}
              aria-label={`${d.date}${d.count ? `, ${d.count} ${d.count === 1 ? 'hearing' : 'hearings'}` : ''}`}
              className={`ct-day${d.isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${d.weekdayIndex >= 5 ? ' is-weekend' : ''}${d.date < today ? ' is-past' : ''}`}
            >
              <span className="ct-day-top">
                <span className="ct-day-num">{Number(d.date.slice(8, 10))}</span>
                {hasHearings && <span className="ct-day-count">{d.count}</span>}
              </span>
              {hasHearings && (
                <span className="ct-day-add" style={{ opacity: 1 }}>
                  {d.count === 1 ? 'hearing' : 'hearings'}
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
      <div className="ct-day-empty">
        <p>Select a day to see its cause list.</p>
      </div>
    );
  }

  const nice = new Date(selected + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="ct-card ct-card-pad" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="ct-section-head">
        <h3 className="ct-section-title" style={{ fontSize: 18 }}>{nice}</h3>
        <span className="ct-rule" />
        <span className="ct-section-count">{hearings.length} {hearings.length === 1 ? 'hearing' : 'hearings'}</span>
      </div>

      {hearings.length === 0 ? (
        <p className="ct-meta" style={{ margin: 0 }}>
          No hearings on this day.
        </p>
      ) : (
        <div className="ct-agenda">
          {hearings.map((h, i) => (
            <div key={h.id ?? `${h.date}-${i}`} className="ct-agenda-row" style={{ gridTemplateColumns: '64px minmax(0, 1fr)', cursor: 'default' }}>
              <span className={`ct-time${h.time ? '' : ' is-empty'}`}>{h.time || '--:--'}</span>
              <span className="col" style={{ gap: 3, minWidth: 0 }}>
                <span className="ct-title">{h.case}</span>
                <span className="ct-meta">{h.purpose}{h.purpose && h.court ? <span className="ct-meta-dot" /> : null}{h.court}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
