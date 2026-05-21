import { useState, type FormEvent } from 'react';
import { DatePicker } from '@lexdraft/ui';
import { useCreateLimitation } from '@/hooks/useLimitations';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
}

function inDays(d: number): string {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
}

export function NewLimitationModal({ open, onClose }: Props) {
  const create = useCreateLimitation();
  const showToast = useUIStore((s) => s.showToast);

  const [caseLabel, setCaseLabel] = useState('');
  const [cnr, setCnr] = useState('');
  const [filingType, setFilingType] = useState('');
  const [forum, setForum] = useState('');
  const [deadline, setDeadline] = useState<string>(inDays(30));
  const [filedBy, setFiledBy] = useState('');

  const reset = () => {
    setCaseLabel('');
    setCnr('');
    setFilingType('');
    setForum('');
    setDeadline(inDays(30));
    setFiledBy('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const created = await create.mutateAsync({
        caseLabel: caseLabel.trim(),
        cnr: cnr.trim(),
        filingType: filingType.trim(),
        forum: forum.trim(),
        deadline,
        filedBy: filedBy.trim(),
      });
      showToast({ type: 'sage', text: `Deadline added for ${created.caseLabel}` });
      reset();
      onClose();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to add deadline';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Add deadline"
      title="Track a limitation"
      description="Required fields marked with *."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Add deadline'}
          </button>
        </>
      }
    >
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
      <div className="form-row">
        <Field label="CNR" hint="Optional">
          <input
            className="input mono"
            value={cnr}
            onChange={(e) => setCnr(e.target.value)}
            placeholder="e.g. KAHC0100012345/2024"
          />
        </Field>
        <Field label="DEADLINE" required>
          <DatePicker value={deadline} onChange={setDeadline} />
        </Field>
        <Field label="FILING TYPE" required>
          <input
            className="input"
            value={filingType}
            onChange={(e) => setFilingType(e.target.value)}
            placeholder="e.g. Reply to written statement"
            required
          />
        </Field>
        <Field label="FORUM">
          <input
            className="input"
            value={forum}
            onChange={(e) => setForum(e.target.value)}
            placeholder="e.g. High Court of Karnataka"
          />
        </Field>
        <Field label="FILED BY (INITIALS)" wide>
          <input
            className="input"
            value={filedBy}
            onChange={(e) => setFiledBy(e.target.value)}
            placeholder="e.g. RM"
          />
        </Field>
      </div>
    </Modal>
  );
}
