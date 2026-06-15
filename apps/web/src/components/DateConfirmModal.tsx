import { useEffect, useState } from 'react';
import { DatePicker } from '@lexdraft/ui';
import { useModalA11y } from '@/hooks/useModalA11y';

interface DateConfirmModalProps {
  open: boolean;
  initial: string;
  onCancel: () => void;
  onConfirm: (date: string) => void;
}

export function DateConfirmModal({ open, initial, onCancel, onConfirm }: DateConfirmModalProps) {
  const shellRef = useModalA11y<HTMLDivElement>(open, onCancel);
  const [date, setDate] = useState(initial);

  useEffect(() => {
    if (open) setDate(initial);
  }, [open, initial]);

  if (!open) return null;

  return (
    <div
      ref={shellRef}
      role="dialog"
      aria-modal
      aria-labelledby="date-confirm-title"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          width: 'min(440px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Date the document</div>
          <h3 id="date-confirm-title" style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
            Confirm document date
          </h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
            The document will be dated as below. Change it if it should bear a different
            date (e.g. a backdated notice or a planned filing date).
          </p>
        </div>

        <div>
          <label className="label">Document date</label>
          <DatePicker value={date} onChange={setDate} />
        </div>

        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onConfirm(date)}
            disabled={!date}
          >
            Generate with this date
          </button>
        </div>
      </div>
    </div>
  );
}
