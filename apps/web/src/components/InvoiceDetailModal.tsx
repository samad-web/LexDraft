import type { Invoice, InvoiceStatus } from '@lexdraft/types';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  invoice: Invoice | null;
  onClose: () => void;
}

const STATUS_BADGE: Record<InvoiceStatus, { label: string; cls: string }> = {
  paid:    { label: 'Paid',    cls: 'cm-pill cm-pill--soft' },
  pending: { label: 'Pending', cls: 'cm-pill cm-pill--line' },
  overdue: { label: 'Overdue', cls: 'cm-pill cm-pill--ink'  },
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
      <div className="cm-invdetail">
        <div className="cm-invdetail-amount">
          <div className="cm-invdetail-head">
            <span className="cm-label">Amount</span>
            <span className={badge.cls}>{badge.label}</span>
          </div>
          <div className="cm-invdetail-figure">₹{formatINR(invoice.amountInr)}</div>
          <div className={`cm-invdetail-due${invoice.status !== 'paid' && due < 0 ? ' is-overdue' : ''}`}>{dueLabel}</div>
        </div>

        <div className="cm-invdetail-grid">
          <DetailRow label="Client" value={invoice.client} />
          <DetailRow label="Issued" value={formatLongDate(invoice.issuedDate)} />
          <DetailRow label="Due" value={formatLongDate(invoice.dueDate)} />
        </div>
      </div>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="cm-label">{label}</div>
      <div className="cm-invdetail-v">{value}</div>
    </div>
  );
}
