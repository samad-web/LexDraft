import { useMemo, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { CalendarHearing } from '@lexdraft/types';
import { useUIStore } from '@/store/ui';
import { useCalendarWeek } from '@/hooks/useCalendar';
import { NewHearingModal } from '@/components/NewHearingModal';

function shiftWeek(weekStart: string, deltaDays: number): string {
  const d = new Date(weekStart + 'T00:00:00');
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CalendarView() {
  const showToast = useUIStore((s) => s.showToast);
  const [weekStart, setWeekStart] = useState<string | undefined>(undefined);
  const { data, isLoading, isError } = useCalendarWeek(weekStart);
  const [selected, setSelected] = useState<string>(todayIso());
  const [modalOpen, setModalOpen] = useState(false);

  const days = data?.days ?? [];
  const selectedCell = days.find((d) => d.date === selected) ?? days[0];

  const dayHearings = useMemo<CalendarHearing[]>(() => {
    if (!selectedCell) return [];
    return (data?.hearings ?? []).filter((h) => h.date === selectedCell.date);
  }, [data, selectedCell]);

  const goPrevWeek = () => {
    const start = data?.weekStart ?? todayIso();
    const prev = shiftWeek(start, -7);
    setWeekStart(prev);
    setSelected(prev);
  };
  const goNextWeek = () => {
    const start = data?.weekStart ?? todayIso();
    const next = shiftWeek(start, 7);
    setWeekStart(next);
    setSelected(next);
  };
  const goToday = () => {
    setWeekStart(undefined);
    setSelected(todayIso());
  };

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Hearings calendar</div>
          <h1 className="heading-xl">Calendar</h1>
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="btn"
          onClick={() => showToast({ type: 'cobalt', text: 'Calendar export queued — .ics file ready shortly' })}
        >
          <Icon name="download" size={14} /> Export ICS
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setModalOpen(true)}
        >
          <Icon name="plus" size={14} /> Add hearing
        </button>
      </div>
      <NewHearingModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultDate={selected}
      />

      <div className="card" style={{ padding: 'var(--space-6)' }}>
        <div className="row" style={{ marginBottom: 16 }}>
          <div className="heading-md">
            {data?.weekStart
              ? new Date(data.weekStart + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
              : new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </div>
          <span className="spacer" />
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm" aria-label="Previous week" onClick={goPrevWeek}>
              <Icon name="chevron" size={12} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <button type="button" className="btn btn-sm" onClick={goToday}>Today</button>
            <button type="button" className="btn btn-sm" aria-label="Next week" onClick={goNextWeek}>
              <Icon name="chevron" size={12} />
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
                  onClick={() => setSelected(d.date)}
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

      {selectedCell && (
        <div>
          <div className="row" style={{ marginBottom: 12 }}>
            <div className="eyebrow">
              {selectedCell.isToday ? 'Today' : selectedCell.weekday} ·{' '}
              <span className="tabular">{selectedCell.date}</span>
            </div>
            <span className="spacer" />
            <span className="mono body-xs muted tabular">
              {dayHearings.length} listed
            </span>
          </div>
          {dayHearings.length > 0 ? (
            <div className="card" style={{ padding: 0 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>Time</th>
                    <th>Matter</th>
                    <th>Court</th>
                    <th>Purpose</th>
                    <th style={{ width: 130 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dayHearings.map((h) => (
                    <tr key={h.id}>
                      <td className="mono tabular" style={{ fontWeight: 500 }}>{h.time}</td>
                      <td>
                        <em className="case-name" style={{ fontWeight: 500 }}>{h.case}</em>
                      </td>
                      <td>
                        <span className="body-sm" style={{ color: 'var(--text-primary)' }}>
                          {h.court}
                        </span>
                      </td>
                      <td className="body-sm">{h.purpose}</td>
                      <td>
                        <span className={`badge ${h.status === 'today' ? 'badge-sage' : h.status === 'past' ? 'badge-cream' : 'badge-cobalt'}`}>
                          {h.status === 'today' ? 'Today' : h.status === 'past' ? 'Past' : 'Upcoming'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--space-9)' }}>
              <p className="body-md muted">No hearings scheduled for this date.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
