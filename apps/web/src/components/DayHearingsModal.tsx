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
        <div className="body-sm muted" style={{ padding: 16, textAlign: 'center' }}>
          Loading hearings<span className="blink" />
        </div>
      ) : hearings.length === 0 ? (
        <div
          className="body-sm muted"
          style={{
            border: '1px dashed var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: 20,
            textAlign: 'center',
          }}
        >
          No hearings scheduled for {iso}.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {hearings.map((h) => {
            const hid = h.id ?? '';
            const isConfirming = !!hid && confirmId === hid;
            return (
              <li
                key={hid || `${h.date}-${h.time}`}
                className="day-hearing-row"
                style={{
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 14px',
                  background: 'var(--bg-surface)',
                }}
              >
                <span
                  className="mono tabular"
                  style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}
                >
                  {h.time || '--:--'}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="body-md" style={{ marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <em className="case-name" style={{ fontWeight: 500 }}>{h.case}</em>
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="body-sm muted">{h.purpose}</span>
                    <span style={{ width: 3, height: 3, background: 'var(--text-tertiary)', borderRadius: '50%' }} />
                    <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)' }}>
                      {h.court.toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {isConfirming ? (
                    <>
                      <span className="body-xs muted" style={{ marginRight: 4 }}>Delete?</span>
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
                        className="btn btn-sm btn-danger"
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
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => hid && setConfirmId(hid)}
                        disabled={!hid}
                        aria-label={`Delete hearing at ${h.time}`}
                        style={{ color: 'var(--danger)' }}
                      >
                        Delete
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
