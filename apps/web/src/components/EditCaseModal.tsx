import { useEffect, useState, type FormEvent } from 'react';
import { DatePicker, Select } from '@lexdraft/ui';
import type { Case, CaseStatus, CaseType } from '@lexdraft/types';
import { useUpdateCase } from '@/hooks/useCases';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

// =============================================================================
// EditCaseModal - edit a matter's particulars after it has been opened. Stage
// moves through the pipeline (POST /cases/:id/transition) and the CNR through
// the eCourts connection card, so neither is edited here.
// =============================================================================

const TYPES: CaseType[] = ['Civil', 'Criminal', 'Commercial', 'Property', 'Banking', 'Family', 'Tax', 'Other'];
const STATUSES: CaseStatus[] = ['Active', 'Pending', 'Closed', 'Archived'];

interface EditCaseModalProps {
  open: boolean;
  onClose: () => void;
  c: Case;
}

export function EditCaseModal({ open, onClose, c }: EditCaseModalProps) {
  const update = useUpdateCase();
  const showToast = useUIStore((s) => s.showToast);

  const [title, setTitle] = useState(c.title);
  const [client, setClient] = useState(c.client);
  const [court, setCourt] = useState(c.court);
  const [type, setType] = useState<CaseType | string>(c.type);
  const [status, setStatus] = useState<CaseStatus>(c.status);
  const [next, setNext] = useState(c.next ?? '');

  // Re-seed from the latest record each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setTitle(c.title);
    setClient(c.client);
    setCourt(c.court);
    setType(c.type);
    setStatus(c.status);
    setNext(c.next ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({
        id: c.id,
        patch: {
          title: title.trim() || c.title,
          client: client.trim(),
          court: court.trim(),
          type,
          status,
          next,
        },
      });
      showToast({ type: 'sage', text: 'Matter updated' });
      onClose();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to update matter';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Edit matter"
      title="Edit particulars"
      description="Change the court level when the matter moves up (e.g. appeal to the High Court) or another advocate takes it over."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <Field label="MATTER TITLE" wide>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="form-row">
        <Field label="CLIENT">
          <input className="input" value={client} onChange={(e) => setClient(e.target.value)} />
        </Field>
        <Field label="COURT LEVEL">
          <input
            className="input"
            value={court}
            onChange={(e) => setCourt(e.target.value)}
            placeholder="e.g. District Court, Chennai / High Court of Madras"
          />
        </Field>
        <Field label="TYPE">
          <Select
            value={String(type)}
            onChange={(v) => setType(v as CaseType)}
            options={TYPES.map((t) => ({ value: t, label: t }))}
          />
        </Field>
        <Field label="STATUS">
          <Select
            value={status}
            onChange={(v) => setStatus(v as CaseStatus)}
            options={STATUSES.map((s) => ({ value: s, label: s }))}
          />
        </Field>
        <Field label="NEXT HEARING">
          <DatePicker value={next} onChange={setNext} />
        </Field>
      </div>
    </Modal>
  );
}
