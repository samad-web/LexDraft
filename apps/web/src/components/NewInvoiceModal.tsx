import { useMemo, useState, type FormEvent } from 'react';
import { Select, DatePicker } from '@lexdraft/ui';
import type { InvoiceStatus } from '@lexdraft/types';
import { useCreateInvoice } from '@/hooks/useInvoices';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';
import { ClientAutocomplete } from './ClientAutocomplete';

interface Props {
  open: boolean;
  onClose: () => void;
}

const STATUSES: InvoiceStatus[] = ['pending', 'paid', 'overdue'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function inDays(d: number): string {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
}

export function NewInvoiceModal({ open, onClose }: Props) {
  const create = useCreateInvoice();
  const showToast = useUIStore((s) => s.showToast);

  const placeholder = useMemo(() => {
    const t = new Date();
    return `INV-${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
  }, [open]);

  const [invoiceNo, setInvoiceNo] = useState('');
  const [client, setClient] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [issuedDate, setIssuedDate] = useState<string>(todayIso());
  const [dueDate, setDueDate] = useState<string>(inDays(30));
  const [status, setStatus] = useState<InvoiceStatus>('pending');

  const reset = () => {
    setInvoiceNo('');
    setClient('');
    setAmount('');
    setIssuedDate(todayIso());
    setDueDate(inDays(30));
    setStatus('pending');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const amt = Number(amount.replace(/[^0-9]/g, '')) || 0;
    try {
      const created = await create.mutateAsync({
        invoiceNo: invoiceNo.trim() || placeholder,
        client: client.trim(),
        amountInr: amt,
        issuedDate,
        dueDate,
        status,
      });
      showToast({ type: 'sage', text: `Invoice ${created.invoiceNo} created` });
      reset();
      onClose();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to create invoice';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="New invoice"
      title="Issue an invoice"
      description="Leave the invoice number blank to auto-generate one."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Create invoice'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="INVOICE NO.">
          <input
            className="input mono"
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
            placeholder={placeholder}
          />
        </Field>
        <Field label="STATUS *">
          <Select
            value={status}
            onChange={(v) => setStatus(v as InvoiceStatus)}
            options={STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
          />
        </Field>
        <Field label="CLIENT *" wide>
          <ClientAutocomplete
            value={client}
            onChange={setClient}
            placeholder="Billed to (party name) — start typing to search clients"
            required
            autoFocus
          />
        </Field>
        <Field label="AMOUNT (INR) *">
          <input
            className="input mono tabular"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="e.g. 125000"
            required
          />
        </Field>
        <Field label="ISSUED *">
          <DatePicker value={issuedDate} onChange={setIssuedDate} />
        </Field>
        <Field label="DUE *">
          <DatePicker value={dueDate} onChange={setDueDate} />
        </Field>
      </div>
    </Modal>
  );
}
