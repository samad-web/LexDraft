import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { CalendarHearing } from '@lexdraft/types';
import { useCalendarDay, useDeleteHearing } from '@/hooks/useCalendar';
import { useUIStore } from '@/store/ui';
import { Modal } from './Modal';

// =============================================================================
// DayHearingsModal - opens when the user clicks any day in the calendar grid.
// Lists every hearing on that date with inline Edit / Delete affordances, plus
// an "Add hearing" CTA. Edit and Add both delegate to the parent which opens
// NewHearingModal on top of this one - the day modal stays mounted so the user
// returns here after the form closes.
// =============================================================================

interface Props {
  open: boolean;
  onClose: () => void;
  iso: string;
  onAdd: () => void;
  onEdit: (hearing: CalendarHearing) => void;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const dt = new Date(iso + 'T00:00:00');
  return dt.toLocaleDateString(undefined, {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
}

export function DayHearingsModal({ open, onClose, iso, onAdd, onEdit }: Props) {
  const del = useDeleteHearing();
  const showToast = useUIStore((s) => s.showToast);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const dayQuery = useCalendarDay(open ? iso : undefined);
  const hearings = dayQuery.data ?? [];

  const handleDelete = async (id: string) => {
    try {
      await del.mutateAsync(id);
      showToast({ type: 'sage', text: 'Hearing deleted' });
      setConfirmId(null);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to delete hearing';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  const eyebrow = `${hearings.length} ${hearings.length === 1 ? 'hearing' : 'hearings'}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={eyebrow}
      title={formatDate(iso)}
      description={
        hearings.length === 0
          ? 'Nothing listed yet. Add the first hearing for this date.'
          : 'Click any hearing to edit it, or add another.'
      }
      width={680}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            <Icon name="plus" size={14} /> Add hearing
          </button>
        </>
      }
    >
      {dayQuery.isLoading ? (
        <div className="col" style={{ gap: 8 }} aria-busy="true" aria-label="Loading hearings">
          {[0, 1].map((i) => <span key={i} className="ct-skel" style={{ height: 66, borderRadius: 10 }} />)}
        </div>
      ) : hearings.length === 0 ? (
        <div className="ct-day-empty">
          <span className="ct-icon-tile" aria-hidden><Icon name="calendar" size={15} /></span>
          <p>No hearings scheduled for {iso}.</p>
        </div>
      ) : (
        <ul className="ct-dayrows">
          {hearings.map((h) => {
            const hid = h.id ?? '';
            const isConfirming = !!hid && confirmId === hid;
            return (
              <li
                key={hid || `${h.date}-${h.time}`}
                className={`ct-dayrow${isConfirming ? ' is-confirming' : ''}`}
              >
                <span className={`ct-time${h.time ? '' : ' is-empty'}`}>{h.time || '--:--'}</span>
                <div className="col" style={{ gap: 3, minWidth: 0 }}>
                  <span className="ct-title">{h.case}</span>
                  <span className="ct-meta">
                    {h.purpose}{h.purpose && h.court ? <span className="ct-meta-dot" /> : null}{h.court}
                    {h.judge ? <><span className="ct-meta-dot" />{h.judge}</> : null}
                  </span>
                </div>
                <div className="ct-dayrow-actions">
                  {isConfirming ? (
                    <>
                      <span className="body-xs" style={{ fontWeight: 600, marginRight: 4 }}>Delete this hearing?</span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setConfirmId(null)}
                        disabled={del.isPending}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-oxblood"
                        onClick={() => hid && handleDelete(hid)}
                        disabled={del.isPending}
                      >
                        {del.isPending ? 'Deleting…' : 'Yes, delete'}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onEdit(h)}
                        aria-label={`Edit hearing at ${h.time}`}
                      >
                        <Icon name="edit" size={12} /> Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => hid && setConfirmId(hid)}
                        disabled={!hid}
                        aria-label={`Delete hearing at ${h.time}`}
                      >
                        <Icon name="trash" size={12} /> Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
