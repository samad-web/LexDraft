import { useMemo, useState } from 'react';
import { Icon, ErrorState } from '@lexdraft/ui';
import type { CalendarHearing } from '@lexdraft/types';
import { useUIStore } from '@/store/ui';
import { useCalendarMonth, useCalendarWeek } from '@/hooks/useCalendar';
import { NewHearingModal } from '@/components/NewHearingModal';
import { DayHearingsModal } from '@/components/DayHearingsModal';
import { downloadIcs, type IcsEvent } from '@/lib/export-doc';
import { PageHeader } from '@/components/PageHeader';

type ViewMode = 'month' | 'week';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
] as const;
const WEEKDAY_HEADERS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] as const;

function shiftWeek(weekStart: string, deltaDays: number): string {
  const d = new Date(weekStart + 'T00:00:00');
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function todayParts(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = (month - 1) + delta;
  const ny = year + Math.floor(idx / 12);
  const nm = ((idx % 12) + 12) % 12 + 1;
  return { year: ny, month: nm };
}

/** Bucket the calendar's flat hearings list by ISO date so each day cell can
 *  cheaply pull its own slice for the hover popover. */
function indexByDate(hearings: CalendarHearing[]): Map<string, CalendarHearing[]> {
  const m = new Map<string, CalendarHearing[]>();
  for (const h of hearings) {
    const list = m.get(h.date) ?? [];
    list.push(h);
    m.set(h.date, list);
  }
  // Sort each day's hearings by time (lexicographic on HH:mm works).
  for (const list of m.values()) list.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  return m;
}

/** Hover preview rendered inside each day cell. Visibility is driven by the
 *  parent `.calendar-day-cell:hover / :focus-visible` rule in globals.css —
 *  no per-cell React state needed. Pointer-events stay off so the popover
 *  never intercepts the click that opens the day modal. */
function HearingsHoverCard({ iso, hearings }: { iso: string; hearings: CalendarHearing[] }) {
  if (hearings.length === 0) return null;
  const shown = hearings.slice(0, 4);
  const overflow = hearings.length - shown.length;
  const niceDate = new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  return (
    <div className="calendar-hover-card" role="tooltip" aria-hidden="true">
      <div className="calendar-hover-card-title">
        {niceDate} · {hearings.length} {hearings.length === 1 ? 'hearing' : 'hearings'}
      </div>
      {shown.map((h, i) => (
        <div key={h.id ?? `${iso}-${i}`} className="calendar-hover-card-row">
          <div className="calendar-hover-card-row-head">
            <span className="calendar-hover-card-time">{h.time || '-'}</span>
            <span className="calendar-hover-card-case">{h.case}</span>
          </div>
          <div className="calendar-hover-card-meta">
            {h.court}
            {h.status && (
              <>
                {' · '}
                <span>{h.status}</span>
              </>
            )}
          </div>
          {h.purpose && <div className="calendar-hover-card-purpose">{h.purpose}</div>}
        </div>
      ))}
      {overflow > 0 && (
        <div className="calendar-hover-card-more">+ {overflow} more · click to view all</div>
      )}
    </div>
  );
}

export function CalendarView() {
  const showToast = useUIStore((s) => s.showToast);
  const [mode, setMode] = useState<ViewMode>('month');
  const [selected, setSelected] = useState<string>(todayIso());

  // Day-modal orchestration: clicking any day in the grid opens DayHearingsModal
  // for that ISO date. From inside it, "Add" pops the create-form on top and
  // "Edit" pops the same form with an existing hearing prefilled.
  const [dayOpen, setDayOpen] = useState(false);
  const [formMode, setFormMode] = useState<'closed' | 'create' | 'edit'>('closed');
  const [editing, setEditing] = useState<CalendarHearing | null>(null);

  const openDay = (iso: string) => {
    setSelected(iso);
    setDayOpen(true);
  };
  const handleAddFromDay = () => setFormMode('create');
  const handleEditFromDay = (h: CalendarHearing) => {
    setEditing(h);
    setFormMode('edit');
  };
  const closeForm = () => {
    setFormMode('closed');
    setEditing(null);
  };

  // Top-bar "Add hearing" button opens the create form for the currently
  // selected day (defaults to today).
  const handleTopAdd = () => setFormMode('create');

  return (
    <div className="col stagger ct ct-calendar" style={{ gap: 24 }}>
      <PageHeader
        title="Calendar"
        description="Your hearings by month or week. Click a day to see or add hearings."
        actions={<>
        <div role="tablist" aria-label="Calendar view" className="ct-seg">
          <ViewToggleButton label="Month" active={mode === 'month'} onClick={() => setMode('month')} />
          <ViewToggleButton label="Week"  active={mode === 'week'}  onClick={() => setMode('week')} />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleTopAdd}
        >
          <Icon name="plus" size={14} /> Add hearing
        </button>
        </>}
      />

      {mode === 'month' ? (
        <MonthPane
          selected={selected}
          onSelect={openDay}
          onExportNotice={(msg, tone) => showToast({ type: tone, text: msg })}
        />
      ) : (
        <WeekPane
          selected={selected}
          onSelect={openDay}
          onExportNotice={(msg, tone) => showToast({ type: tone, text: msg })}
        />
      )}

      <DayHearingsModal
        open={dayOpen}
        onClose={() => setDayOpen(false)}
        iso={selected}
        onAdd={handleAddFromDay}
        onEdit={handleEditFromDay}
      />

      <NewHearingModal
        open={formMode !== 'closed'}
        onClose={closeForm}
        defaultDate={selected}
        existing={formMode === 'edit' ? editing ?? undefined : undefined}
      />
    </div>
  );
}

function ViewToggleButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}>
      {label}
    </button>
  );
}

function exportEvents(all: CalendarHearing[]): IcsEvent[] {
  return all.map((h, i) => {
    const [hh = '10', mm = '00'] = (h.time || '10:00').split(':');
    const start = new Date(`${h.date}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
      uid: h.id ?? `hearing-${h.date}-${i}`,
      start, end,
      summary: `${h.case} - ${h.purpose}`,
      location: h.court,
      description: `Status: ${h.status}`,
    };
  });
}

/** The first hearings of a day, listed inside its cell. */
function DayItems({ hearings, max }: { hearings: CalendarHearing[]; max: number }) {
  if (hearings.length === 0) return null;
  const shown = hearings.slice(0, max);
  return (
    <span className="ct-day-items" aria-hidden="true">
      {shown.map((h, i) => (
        <span key={h.id ?? i} className="ct-day-item">
          <b>{h.time || '--:--'}</b>
          <span>{h.case}</span>
        </span>
      ))}
      {hearings.length > shown.length && <span className="ct-day-more">+{hearings.length - shown.length} more</span>}
    </span>
  );
}

function CalNav({ label, onPrev, onToday, onNext, onExport }: {
  label: string; onPrev: () => void; onToday: () => void; onNext: () => void; onExport: () => void;
}) {
  return (
    <div className="ct-cal-nav">
      <button type="button" className="btn btn-sm" aria-label={`Previous ${label}`} onClick={onPrev}>
        <Icon name="chevron" size={12} style={{ transform: 'rotate(180deg)' }} />
      </button>
      <button type="button" className="btn btn-sm" onClick={onToday}>Today</button>
      <button type="button" className="btn btn-sm" aria-label={`Next ${label}`} onClick={onNext}>
        <Icon name="chevron" size={12} />
      </button>
      <button type="button" className="btn btn-sm ct-cal-export" onClick={onExport}>
        <Icon name="download" size={12} /> Export ICS
      </button>
    </div>
  );
}

// ============================================================================
// MONTH PANE - 6-row x 7-col grid, prev/next/today nav.
// ============================================================================

function MonthPane({
  selected,
  onSelect,
  onExportNotice,
}: {
  selected: string;
  onSelect: (iso: string) => void;
  onExportNotice: (msg: string, tone: 'sage' | 'amber' | 'vermillion') => void;
}) {
  const initial = useMemo(() => todayParts(), []);
  const [{ year, month }, setCursor] = useState(initial);
  const { data, isLoading, isError } = useCalendarMonth(year, month, true);

  const goPrev  = () => setCursor((c) => shiftMonth(c.year, c.month, -1));
  const goNext  = () => setCursor((c) => shiftMonth(c.year, c.month, +1));
  const goToday = () => {
    setCursor(todayParts());
    onSelect(todayIso());
  };

  const today = todayIso();
  const totalHearings = data?.hearings.length ?? 0;
  const days = data?.days ?? [];
  const leading = days[0] ? days[0].weekdayIndex : 0;
  const hearingsByDate = useMemo(() => indexByDate(data?.hearings ?? []), [data?.hearings]);
  const busyDays = days.filter((d) => d.count > 0).length;
  const upcoming = useMemo(
    () => (data?.hearings ?? []).filter((h) => h.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '')).slice(0, 6),
    [data?.hearings, today],
  );

  const doExport = () => {
    const all = data?.hearings ?? [];
    if (all.length === 0) {
      onExportNotice('No hearings this month to export', 'amber');
      return;
    }
    const events = exportEvents(all);
    downloadIcs(`hearings-${year}-${String(month).padStart(2, '0')}.ics`, events);
    onExportNotice(`Exported ${events.length} hearings to .ics`, 'sage');
  };

  return (
    <div className="col" style={{ gap: 20 }}>
    <div className="ct-card ct-card-pad ct-cal ct-cal-card ct-month">
      <div className="ct-cal-head">
        <div>
          <div className="ct-eyebrow">Month</div>
          <h2 className="ct-cal-title">{MONTH_NAMES[month - 1]} <span style={{ fontWeight: 400 }}>{year}</span></h2>
          <div className="ct-cal-sub">
            {isLoading ? 'Loading hearings…'
              : isError ? 'Could not load hearings for this month.'
              : <><b>{totalHearings}</b> {totalHearings === 1 ? 'hearing' : 'hearings'} this month{busyDays > 0 ? <> across <b>{busyDays}</b> {busyDays === 1 ? 'day' : 'days'}</> : null}</>}
          </div>
        </div>
        <CalNav label="month" onPrev={goPrev} onToday={goToday} onNext={goNext} onExport={doExport} />
      </div>

      {/* Weekday header */}
      <div className="ct-cal-grid">
        {WEEKDAY_HEADERS.map((w, i) => (
          <div key={w} className={`ct-cal-wd${i >= 5 ? ' is-weekend' : ''}`}>{w}</div>
        ))}
      </div>

      {isLoading ? (
        <div className="ct-cal-grid" aria-busy="true" aria-label="Loading month">
          {Array.from({ length: 35 }, (_, i) => (
            <span key={`sk-day-${i}`} className="ct-skel ct-cal-pad" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          variant="inline"
          title="Couldn't load month"
          description="Check your connection and try again."
        />
      ) : (
        <div className="ct-cal-grid">
          {Array.from({ length: leading }).map((_, i) => (
            <div key={`pad-${i}`} aria-hidden className="ct-cal-pad" />
          ))}
          {days.map((d) => {
            const isSelected = d.date === selected;
            const dayNum = Number(d.date.slice(8, 10));
            const hasHearings = d.count > 0;
            const list = hearingsByDate.get(d.date) ?? [];
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => onSelect(d.date)}
                aria-pressed={isSelected}
                aria-label={`${d.date}${d.count ? `, ${d.count} ${d.count === 1 ? 'hearing' : 'hearings'}` : ''}`}
                className={`calendar-day-cell ct-day${d.isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${d.weekdayIndex >= 5 ? ' is-weekend' : ''}${d.date < today ? ' is-past' : ''}`}
              >
                <span className="ct-day-top">
                  <span className="ct-day-num">{dayNum}</span>
                  {hasHearings && <span className="ct-day-count">{d.count}</span>}
                </span>
                {hasHearings ? <DayItems hearings={list} max={2} /> : <span className="ct-day-add cal-add">+ Add</span>}
                {hasHearings && (
                  <HearingsHoverCard iso={d.date} hearings={list} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>

    {!isLoading && !isError && (
      <div className="ct-card ct-card-pad">
        <div className="ct-section-head" style={{ marginBottom: 6 }}>
          <h3 className="ct-section-title">Coming up</h3>
          <span className="ct-rule" />
          <span className="ct-section-count">{upcoming.length ? `Next ${upcoming.length} this month` : 'Nothing ahead this month'}</span>
        </div>
        {upcoming.length === 0 ? (
          <p className="ct-meta" style={{ margin: '8px 0 0' }}>No more hearings listed in {MONTH_NAMES[month - 1]}. Pick a day above to add one.</p>
        ) : (
          <div className="ct-agenda">
            {upcoming.map((h, i) => {
              const dt = new Date(`${h.date}T00:00:00`);
              return (
                <button key={h.id ?? i} type="button" className="ct-agenda-row" onClick={() => onSelect(h.date)}>
                  <span className={`ct-date${h.date === today ? ' is-today' : ''}`}>
                    <span className="ct-date-wd">{dt.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                    <span className="ct-date-d">{dt.getDate()}</span>
                    <span className="ct-date-mo">{dt.toLocaleDateString('en-IN', { month: 'short' })}</span>
                  </span>
                  <span className="col" style={{ gap: 3, minWidth: 0 }}>
                    <span className="ct-title">{h.case}</span>
                    <span className="ct-meta">{h.purpose}{h.purpose && h.court ? <span className="ct-meta-dot" /> : null}{h.court}</span>
                  </span>
                  <span className={`ct-time${h.time ? '' : ' is-empty'}`}>{h.time || '--:--'}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    )}
    </div>
  );
}

// ============================================================================
// WEEK PANE - original 7-day strip preserved for users who prefer week view.
// ============================================================================

function WeekPane({
  selected,
  onSelect,
  onExportNotice,
}: {
  selected: string;
  onSelect: (iso: string) => void;
  onExportNotice: (msg: string, tone: 'sage' | 'amber' | 'vermillion') => void;
}) {
  const [weekStart, setWeekStart] = useState<string | undefined>(undefined);
  const { data, isLoading, isError } = useCalendarWeek(weekStart);

  const days = data?.days ?? [];
  const hearingsByDate = useMemo(() => indexByDate(data?.hearings ?? []), [data?.hearings]);
  const today = todayIso();
  const total = data?.hearings.length ?? 0;

  const goPrev = () => {
    const start = data?.weekStart ?? todayIso();
    const prev = shiftWeek(start, -7);
    setWeekStart(prev);
  };
  const goNext = () => {
    const start = data?.weekStart ?? todayIso();
    const next = shiftWeek(start, 7);
    setWeekStart(next);
  };
  const goToday = () => {
    setWeekStart(undefined);
    onSelect(todayIso());
  };
  const doExport = () => {
    const all = data?.hearings ?? [];
    if (all.length === 0) {
      onExportNotice('No hearings this week to export', 'amber');
      return;
    }
    const events = exportEvents(all);
    downloadIcs(`hearings-week-${data?.weekStart ?? todayIso()}.ics`, events);
    onExportNotice(`Exported ${events.length} hearings to .ics`, 'sage');
  };

  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', o);

  return (
    <div className="ct-card ct-card-pad ct-cal ct-cal-card ct-week">
      <div className="ct-cal-head">
        <div>
          <div className="ct-eyebrow">Week</div>
          <h2 className="ct-cal-title">
            {data?.weekStart
              ? new Date(data.weekStart + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
              : new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h2>
          <div className="ct-cal-sub">
            {isLoading ? 'Loading hearings…'
              : isError ? 'Could not load this week.'
              : <>{first && last ? `${fmt(first, { day: 'numeric', month: 'short' })} – ${fmt(last, { day: 'numeric', month: 'short' })} · ` : ''}<b>{total}</b> {total === 1 ? 'hearing' : 'hearings'}</>}
          </div>
        </div>
        <CalNav label="week" onPrev={goPrev} onToday={goToday} onNext={goNext} onExport={doExport} />
      </div>
      {isLoading ? (
        <div className="ct-cal-grid" aria-busy="true" aria-label="Loading week">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={`sk-wk-${i}`} className="ct-skel" style={{ minHeight: 120 }} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          variant="inline"
          title="Couldn't load calendar"
          description="Check your connection and try again."
        />
      ) : (
        <div className="ct-cal-grid">
          {days.map((d, idx) => {
            const isSelected = d.date === selected;
            const dayNum = Number(d.date.slice(8, 10));
            const list = hearingsByDate.get(d.date) ?? [];
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => onSelect(d.date)}
                aria-label={`${d.date}, ${d.count} ${d.count === 1 ? 'hearing' : 'hearings'}`}
                className={`calendar-day-cell ct-day${d.isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${idx >= 5 ? ' is-weekend' : ''}${d.date < today ? ' is-past' : ''}`}
              >
                <span className="ct-day-top">
                  <span className="ct-day-wd">{d.weekday}</span>
                  <span className="ct-day-num">{dayNum}</span>
                </span>
                {list.length > 0
                  ? <DayItems hearings={list} max={4} />
                  : <span className="ct-day-add cal-add">{d.count > 0 ? `${d.count} ${d.count === 1 ? 'hearing' : 'hearings'}` : 'No hearings · + Add'}</span>}
                {d.count > 0 && (
                  <HearingsHoverCard iso={d.date} hearings={list} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
