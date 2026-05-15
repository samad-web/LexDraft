import { useMemo, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { CalendarHearing } from '@lexdraft/types';
import { useUIStore } from '@/store/ui';
import { useCalendarMonth, useCalendarWeek } from '@/hooks/useCalendar';
import { NewHearingModal } from '@/components/NewHearingModal';
import { DayHearingsModal } from '@/components/DayHearingsModal';
import { downloadIcs, type IcsEvent } from '@/lib/export-doc';

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
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Hearings calendar</div>
          <h1 className="heading-xl">Calendar</h1>
        </div>
        <span className="spacer" />
        <div
          role="tablist"
          aria-label="Calendar view"
          className="row"
          style={{
            gap: 0,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-full)',
            padding: 3,
          }}
        >
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
      </div>

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
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        appearance: 'none',
        cursor: 'pointer',
        padding: '6px 16px',
        borderRadius: 'var(--radius-full)',
        border: 'none',
        background: active ? 'var(--text-primary)' : 'transparent',
        color: active ? 'var(--bg-base)' : 'var(--text-secondary)',
        fontSize: 13,
        fontWeight: 500,
        transition: 'background 150ms, color 150ms',
      }}
    >
      {label}
    </button>
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

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const totalHearings = data?.hearings.length ?? 0;
  const days = data?.days ?? [];
  const leading = days[0] ? days[0].weekdayIndex : 0;

  return (
    <div className="card" style={{ padding: 'var(--space-6)' }}>
      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="heading-md">{monthLabel}</div>
          <div className="body-sm muted" style={{ marginTop: 4 }}>
            {isLoading ? 'Loading hearings…'
              : isError ? 'Could not load hearings for this month.'
              : `${totalHearings} ${totalHearings === 1 ? 'hearing' : 'hearings'} this month`}
          </div>
        </div>
        <span className="spacer" />
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn btn-sm" aria-label="Previous month" onClick={goPrev}>
            <Icon name="chevron" size={12} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button type="button" className="btn btn-sm" onClick={goToday}>Today</button>
          <button type="button" className="btn btn-sm" aria-label="Next month" onClick={goNext}>
            <Icon name="chevron" size={12} />
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const all = data?.hearings ?? [];
              if (all.length === 0) {
                onExportNotice('No hearings this month to export', 'amber');
                return;
              }
              const events: IcsEvent[] = all.map((h, i) => {
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
              downloadIcs(`hearings-${year}-${String(month).padStart(2, '0')}.ics`, events);
              onExportNotice(`Exported ${events.length} hearings to .ics`, 'sage');
            }}
          >
            <Icon name="download" size={12} /> Export ICS
          </button>
        </div>
      </div>

      {/* Weekday header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: 8,
          marginBottom: 8,
        }}
      >
        {WEEKDAY_HEADERS.map((w) => (
          <div
            key={w}
            className="mono"
            style={{
              fontSize: 11,
              letterSpacing: '0.16em',
              color: 'var(--text-tertiary)',
              textAlign: 'center',
              textTransform: 'uppercase',
              padding: '4px 0',
            }}
          >
            {w}
          </div>
        ))}
      </div>

      {isLoading ? (
        <p className="body-sm muted" style={{ padding: '24px 0', textAlign: 'center' }}>
          Loading month<span className="blink" />
        </p>
      ) : isError ? (
        <p className="body-sm" style={{ color: 'var(--danger)', padding: '24px 0', textAlign: 'center' }}>
          Couldn’t load month.
        </p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            gap: 8,
          }}
        >
          {Array.from({ length: leading }).map((_, i) => (
            <div key={`pad-${i}`} aria-hidden style={{ minHeight: 96 }} />
          ))}
          {days.map((d) => {
            const isSelected = d.date === selected;
            const dayNum = Number(d.date.slice(8, 10));
            const hasHearings = d.count > 0;
            const tone =
              d.isToday
                ? { bg: 'var(--text-primary)', fg: 'var(--bg-base)',      border: 'var(--text-primary)' }
                : isSelected
                  ? { bg: 'var(--bg-surface-2)', fg: 'var(--text-primary)', border: 'var(--text-primary)' }
                  : { bg: 'var(--bg-surface)',   fg: 'var(--text-primary)', border: 'var(--border-default)' };
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
                  padding: 'var(--space-3) var(--space-3)',
                  minHeight: 96,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 8,
                  transition: 'background 150ms, border-color 150ms',
                  textAlign: 'left',
                }}
              >
                <span
                  className="mono tabular"
                  style={{ fontSize: 18, fontWeight: 600, lineHeight: 1 }}
                >
                  {dayNum}
                </span>
                {hasHearings ? (
                  <span
                    className={`badge ${d.isToday ? '' : 'badge-cobalt'}`}
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      background: d.isToday ? 'rgba(255,255,255,0.18)' : undefined,
                      color: d.isToday ? 'var(--bg-base)' : undefined,
                      borderColor: d.isToday ? 'rgba(255,255,255,0.3)' : undefined,
                    }}
                  >
                    {d.count} {d.count === 1 ? 'hearing' : 'hearings'}
                  </span>
                ) : (
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: d.isToday ? 'var(--bg-base)' : 'var(--text-tertiary)',
                      opacity: d.isToday ? 0.7 : 1,
                    }}
                  >
                    Add
                  </span>
                )}
              </button>
            );
          })}
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

  return (
    <div className="card" style={{ padding: 'var(--space-6)' }}>
      <div className="row" style={{ marginBottom: 16 }}>
        <div className="heading-md">
          {data?.weekStart
            ? new Date(data.weekStart + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
            : new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </div>
        <span className="spacer" />
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn btn-sm" aria-label="Previous week" onClick={goPrev}>
            <Icon name="chevron" size={12} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button type="button" className="btn btn-sm" onClick={goToday}>Today</button>
          <button type="button" className="btn btn-sm" aria-label="Next week" onClick={goNext}>
            <Icon name="chevron" size={12} />
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const all = data?.hearings ?? [];
              if (all.length === 0) {
                onExportNotice('No hearings this week to export', 'amber');
                return;
              }
              const events: IcsEvent[] = all.map((h, i) => {
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
              downloadIcs(`hearings-week-${data?.weekStart ?? todayIso()}.ics`, events);
              onExportNotice(`Exported ${events.length} hearings to .ics`, 'sage');
            }}
          >
            <Icon name="download" size={12} /> Export ICS
          </button>
        </div>
      </div>
      {isLoading ? (
        <p className="body-sm muted">Loading week<span className="blink" /></p>
      ) : isError ? (
        <p className="body-sm" style={{ color: 'var(--danger)' }}>Couldn’t load calendar.</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            gap: 10,
          }}
        >
          {days.map((d) => {
            const isSelected = d.date === selected;
            const dayNum = Number(d.date.slice(8, 10));
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => onSelect(d.date)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: 'var(--space-4)',
                  border: '1px solid',
                  borderColor: isSelected ? 'var(--text-primary)' : 'var(--border-default)',
                  background: isSelected ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  minHeight: 96,
                  transition: 'border-color 150ms, background 150ms',
                }}
              >
                <div className="eyebrow" style={{ color: 'var(--text-tertiary)' }}>
                  {d.weekday}
                </div>
                <div
                  className="mono tabular"
                  style={{
                    fontSize: 22,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    lineHeight: 1,
                  }}
                >
                  {dayNum}
                  {d.isToday && (
                    <span
                      aria-hidden="true"
                      className="dot dot-cobalt"
                      style={{ marginLeft: 6, verticalAlign: 'middle' }}
                    />
                  )}
                </div>
                <span
                  className={`badge ${d.count === 0 ? 'badge-cream' : 'badge-cobalt'}`}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {d.count} {d.count === 1 ? 'hearing' : 'hearings'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
