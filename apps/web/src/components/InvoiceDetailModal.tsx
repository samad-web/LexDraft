import type { Invoice, InvoiceStatus } from '@lexdraft/types';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  invoice: Invoice | null;
  onClose: () => void;
}

const STATUS_BADGE: Record<InvoiceStatus, { label: string; cls: string }> = {
  paid:    { label: 'PAID',    cls: 'badge-sage'       },
  pending: { label: 'PENDING', cls: 'badge-cobalt'     },
  overdue: { label: 'OVERDUE', cls: 'badge-vermillion' },
};

function formatINR(value: number): string {
  return value.toLocaleString('en-IN');
}

function formatLongDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysUntil(iso: string): number {
  const due = new Date(`${iso}T00:00:00`).getTime();
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00').getTime();
  return Math.round((due - today) / (1000 * 60 * 60 * 24));
}

export function InvoiceDetailModal({ open, invoice, onClose }: Props) {
  if (!invoice) return null;

  const badge = STATUS_BADGE[invoice.status];
  const due = daysUntil(invoice.dueDate);
  const dueLabel =
    invoice.status === 'paid'
      ? 'Settled'
      : due > 0
        ? `Due in ${due} day${due === 1 ? '' : 's'}`
        : due === 0
          ? 'Due today'
          : `Overdue by ${Math.abs(due)} day${Math.abs(due) === 1 ? '' : 's'}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Invoice detail"
      title={invoice.invoiceNo}
      width={520}
      footer={
        <button type="button" className="btn" onClick={onClose}>Close</button>
      }
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
            CLIENT
          </div>
          <div className="body-md" style={{ marginTop: 4 }}>{invoice.client}</div>
        </div>
        <span className={`badge ${badge.cls}`} style={{ flex: '0 0 auto' }}>{badge.label}</span>
      </div>

      <hr className="hairline" />

      <div>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
          AMOUNT
        </div>
        <div className="heading-lg mono tabular" style={{ marginTop: 4 }}>
          ₹{formatINR(invoice.amountInr)}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <DetailRow label="ISSUED" value={formatLongDate(invoice.issuedDate)} />
        <DetailRow label="DUE" value={formatLongDate(invoice.dueDate)} hint={dueLabel} />
      </div>
    </Modal>
  );
}

function DetailRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div className="mono tabular" style={{ marginTop: 4, fontSize: 14, color: 'var(--text-primary)' }}>
        {value}
      </div>
      {hint && (
        <div className="body-sm muted" style={{ marginTop: 4 }}>{hint}</div>
      )}
    </div>
  );
}
