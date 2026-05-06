import { useMemo, useState, type FormEvent } from 'react';
import { Select, DatePicker } from '@lexdraft/ui';
import type { ExpenseStatus } from '@lexdraft/types';
import { useCreateExpense } from '@/hooks/useExpenses';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
}

const STATUSES: ExpenseStatus[] = ['pending', 'approved', 'billed'];
const CATEGORIES = ['Court fees', 'Travel', 'Photocopy', 'Process serving', 'Stationery', 'Other'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NewExpenseModal({ open, onClose }: Props) {
  const create = useCreateExpense();
  const showToast = useUIStore((s) => s.showToast);

  const placeholder = useMemo(() => {
    const t = new Date();
    return `EXP-${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
  }, [open]);

  const [expenseNo, setExpenseNo] = useState('');
  const [date, setDate] = useState<string>(todayIso());
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]!);
  const [caseLabel, setCaseLabel] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [status, setStatus] = useState<ExpenseStatus>('pending');
  const [reimbursable, setReimbursable] = useState(false);
  const [billable, setBillable] = useState(true);

  const reset = () => {
    setExpenseNo('');
    setDate(todayIso());
    setDescription('');
    setCategory(CATEGORIES[0]!);
    setCaseLabel('');
    setAmount('');
    setStatus('pending');
    setReimbursable(false);
    setBillable(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const amt = Number(amount.replace(/[^0-9]/g, '')) || 0;
    try {
      const created = await create.mutateAsync({
        expenseNo: expenseNo.trim() || placeholder,
        date,
        description: description.trim(),
        category,
        caseLabel: caseLabel.trim(),
        amountInr: amt,
        status,
        reimbursable,
        billable,
      });
      showToast({ type: 'sage', text: `Expense ${created.expenseNo} logged` });
      reset();
      onClose();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to log expense';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Log expense"
      title="Record a disbursement"
      description="Leave the reference blank to auto-generate one."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Log expense'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="REFERENCE">
          <input
            className="input mono"
            value={expenseNo}
            onChange={(e) => setExpenseNo(e.target.value)}
            placeholder={placeholder}
          />
        </Field>
        <Field label="DATE *">
          <DatePicker value={date} onChange={setDate} />
        </Field>
        <Field label="DESCRIPTION *" wide>
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Court fees for filing of plaint"
            required
            autoFocus
          />
        </Field>
        <Field label="CATEGORY *">
          <Select
            value={category}
            onChange={setCategory}
            options={CATEGORIES.map((c) => ({ value: c, label: c }))}
          />
        </Field>
        <Field label="MATTER">
          <input
            className="input"
            value={caseLabel}
            onChange={(e) => setCaseLabel(e.target.value)}
            placeholder="Tag to a matter (optional)"
          />
        </Field>
        <Field label="AMOUNT (INR) *">
          <input
            className="input mono tabular"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="e.g. 2500"
            required
          />
        </Field>
        <Field label="STATUS *">
          <Select
            value={status}
            onChange={(v) => setStatus(v as ExpenseStatus)}
            options={STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
          />
        </Field>
        <div
          style={{
            gridColumn: '1 / -1',
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            paddingTop: 4,
          }}
        >
          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={reimbursable}
              onChange={(e) => setReimbursable(e.target.checked)}
            />
            <span className="body-sm">Reimbursable</span>
          </label>
          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={billable}
              onChange={(e) => setBillable(e.target.checked)}
            />
            <span className="body-sm">Billable</span>
          </label>
        </div>
      </div>
    </Modal>
  );
}
