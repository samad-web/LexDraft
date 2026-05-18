import { useState, type FormEvent } from 'react';
import { Select, DatePicker, TimePicker } from '@lexdraft/ui';
import type { DiaryKind } from '@lexdraft/types';
import { useCreateDiaryEntry } from '@/hooks/useDiary';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
}

const KINDS: DiaryKind[] = ['hearing', 'judgment', 'filing'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NewDiaryEntryModal({ open, onClose }: Props) {
  const create = useCreateDiaryEntry();
  const showToast = useUIStore((s) => s.showToast);

  const [date, setDate] = useState<string>(todayIso());
  const [time, setTime] = useState<string>('10:30');
  const [kind, setKind] = useState<DiaryKind>('hearing');
  const [caseLabel, setCaseLabel] = useState('');
  const [cnr, setCnr] = useState('');
  const [detail, setDetail] = useState('');
  const [forum, setForum] = useState('');

  const reset = () => {
    setDate(todayIso());
    setTime('10:30');
    setKind('hearing');
    setCaseLabel('');
    setCnr('');
    setDetail('');
    setForum('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync({
        date,
        time,
        kind,
        caseLabel: caseLabel.trim(),
        cnr: cnr.trim(),
        detail: detail.trim(),
        forum: forum.trim(),
      });
      showToast({ type: 'sage', text: 'Diary entry added' });
      reset();
      onClose();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to add diary entry';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="New diary entry"
      title="Log to court diary"
      description="Required fields marked with *."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Add entry'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="DATE" required>
          <DatePicker value={date} onChange={setDate} />
        </Field>
        <Field label="TIME">
          <TimePicker value={time} onChange={setTime} />
        </Field>
        <Field label="KIND" required>
          <Select
            value={kind}
            onChange={(v) => setKind(v as DiaryKind)}
            options={KINDS.map((k) => ({ value: k, label: k.charAt(0).toUpperCase() + k.slice(1) }))}
          />
        </Field>
        <Field label="CNR" hint="Optional">
          <input
            className="input mono"
            value={cnr}
            onChange={(e) => setCnr(e.target.value)}
            placeholder="e.g. KAHC0100012345/2024"
          />
        </Field>
        <Field label="MATTER" required wide>
          <input
            className="input"
            value={caseLabel}
            onChange={(e) => setCaseLabel(e.target.value)}
            placeholder="e.g. Mehta v. Skyline"
            required
            autoFocus
          />
        </Field>
        <Field label="DETAIL" wide>
          <textarea
            className="input"
            rows={3}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Short note about the entry"
          />
        </Field>
        <Field label="FORUM" wide>
          <input
            className="input"
            value={forum}
            onChange={(e) => setForum(e.target.value)}
            placeholder="e.g. High Court of Karnataka, Court Hall 12"
          />
        </Field>
      </div>
    </Modal>
  );
}
