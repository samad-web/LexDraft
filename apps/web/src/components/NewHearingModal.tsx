import { useState, type FormEvent } from 'react';
import { Select, DatePicker, TimePicker } from '@lexdraft/ui';
import { useCreateHearing } from '@/hooks/useCalendar';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional defaults — when added from a case detail page. */
  defaultCase?: string;
  defaultCourt?: string;
  defaultDate?: string;
}

type Status = 'today' | 'upcoming' | 'past';
const STATUSES: Status[] = ['upcoming', 'today', 'past'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NewHearingModal({
  open,
  onClose,
  defaultCase,
  defaultCourt,
  defaultDate,
}: Props) {
  const create = useCreateHearing();
  const showToast = useUIStore((s) => s.showToast);

  const [caseLabel, setCaseLabel] = useState(defaultCase ?? '');
  const [date, setDate] = useState<string>(defaultDate ?? todayIso());
  const [time, setTime] = useState<string>('10:30');
  const [court, setCourt] = useState(defaultCourt ?? '');
  const [purpose, setPurpose] = useState('');
  const [status, setStatus] = useState<Status>('upcoming');
  const [judge, setJudge] = useState('');

  const reset = () => {
    setCaseLabel(defaultCase ?? '');
    setDate(defaultDate ?? todayIso());
    setTime('10:30');
    setCourt(defaultCourt ?? '');
    setPurpose('');
    setStatus('upcoming');
    setJudge('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync({
        case: caseLabel.trim(),
        time,
        court: court.trim(),
        purpose: purpose.trim(),
        status,
        date,
        judge: judge.trim(),
      });
      showToast({ type: 'sage', text: `Hearing scheduled for ${date}` });
      reset();
      onClose();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to schedule hearing';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Add hearing"
      title="Schedule a hearing"
      description="Required fields marked with *."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Add hearing'}
          </button>
        </>
      }
    >
      <Field label="MATTER *" wide>
        <input
          className="input"
          value={caseLabel}
          onChange={(e) => setCaseLabel(e.target.value)}
          placeholder="e.g. Mehta v. Skyline"
          required
          autoFocus
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="DATE *">
          <DatePicker value={date} onChange={setDate} />
        </Field>
        <Field label="TIME *">
          <TimePicker value={time} onChange={setTime} />
        </Field>
        <Field label="COURT *">
          <input
            className="input"
            value={court}
            onChange={(e) => setCourt(e.target.value)}
            placeholder="e.g. High Court of Karnataka"
            required
          />
        </Field>
        <Field label="JUDGE">
          <input
            className="input"
            value={judge}
            onChange={(e) => setJudge(e.target.value)}
            placeholder="Optional"
          />
        </Field>
        <Field label="PURPOSE *" wide>
          <input
            className="input"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Arguments on interim relief"
            required
          />
        </Field>
        <Field label="STATUS *">
          <Select
            value={status}
            onChange={(v) => setStatus(v as Status)}
            options={STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
          />
        </Field>
      </div>
    </Modal>
  );
}
