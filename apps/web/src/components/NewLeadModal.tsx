import { useState, type FormEvent } from 'react';
import { Select } from '@lexdraft/ui';
import type { LeadStage } from '@lexdraft/types';
import { useCreateLead } from '@/hooks/useLeads';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
}

// Only the early intake stages are offered at capture time — a lead is not
// captured directly as "engagement sent"/"retained"/"declined".
const CAPTURE_STAGES: { value: LeadStage; label: string }[] = [
  { value: 'new', label: 'New enquiry' },
  { value: 'conflict', label: 'Conflict check' },
  { value: 'consultation', label: 'Consultation' },
];

// A short, editable list of common practice areas. Free text is also allowed.
const PRACTICE_AREAS = [
  'Criminal — Bail',
  'Criminal — Trial',
  'Civil — Recovery',
  'Civil — Property',
  'Family — Matrimonial',
  'Cheque bounce (s.138 NI Act)',
  'Consumer',
  'Service / Writ',
  'Corporate / Commercial',
  'Other',
];

export function NewLeadModal({ open, onClose }: Props) {
  const create = useCreateLead();
  const showToast = useUIStore((s) => s.showToast);

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [practiceArea, setPracticeArea] = useState('');
  const [matterSummary, setMatterSummary] = useState('');
  const [valueInr, setValueInr] = useState<string>('');
  const [probability, setProbability] = useState<string>('50');
  const [referrer, setReferrer] = useState('');
  const [stage, setStage] = useState<LeadStage>('new');

  const reset = () => {
    setName('');
    setContact('');
    setPracticeArea('');
    setMatterSummary('');
    setValueInr('');
    setProbability('50');
    setReferrer('');
    setStage('new');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const value = Number(valueInr.replace(/[^0-9]/g, '')) || 0;
    const prob = Math.max(0, Math.min(100, Number(probability) || 0));
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        valueInr: value,
        referrer: referrer.trim(),
        stage,
        contact: contact.trim(),
        practiceArea: practiceArea.trim(),
        matterSummary: matterSummary.trim(),
        probability: prob,
        conflictStatus: '',
        declineReason: '',
      });
      showToast({ type: 'sage', text: `Lead "${created.name}" captured` });
      reset();
      onClose();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to capture lead';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Capture lead"
      title="New intake enquiry"
      description="Capture what the prospect brought. Run the conflict check before sending an engagement."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Capture lead'}
          </button>
        </>
      }
    >
      <Field label="PROSPECT NAME" required wide>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ramesh Kumar / ABC Industries Pvt. Ltd."
          required
          autoFocus
        />
      </Field>
      <Field label="CONTACT" hint="Phone or email — needed to open the client on retainer" wide>
        <input
          className="input"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="e.g. 98xxxxxxx / ramesh@example.com"
        />
      </Field>
      <Field label="MATTER" hint="One line on what they need" wide>
        <input
          className="input"
          value={matterSummary}
          onChange={(e) => setMatterSummary(e.target.value)}
          placeholder="e.g. Bail in FIR 214/2026, cheating"
        />
      </Field>
      <div className="form-row">
        <Field label="PRACTICE AREA">
          <Select
            value={practiceArea}
            onChange={(v) => setPracticeArea(v)}
            options={[
              { value: '', label: 'Select…' },
              ...PRACTICE_AREAS.map((p) => ({ value: p, label: p })),
            ]}
          />
        </Field>
        <Field label="STAGE" required>
          <Select
            value={stage}
            onChange={(v) => setStage(v as LeadStage)}
            options={CAPTURE_STAGES}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="ESTIMATED FEE" hint="₹ (optional)">
          <input
            className="input mono tabular"
            inputMode="numeric"
            value={valueInr}
            onChange={(e) => setValueInr(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="250000"
          />
        </Field>
        <Field label="LIKELIHOOD" hint="% chance of retaining">
          <input
            className="input mono tabular"
            inputMode="numeric"
            value={probability}
            onChange={(e) => setProbability(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
            placeholder="50"
          />
        </Field>
        <Field label="SOURCE" hint="Referrer / channel" wide>
          <input
            className="input"
            value={referrer}
            onChange={(e) => setReferrer(e.target.value)}
            placeholder="e.g. Repeat client / Senior counsel / Website"
          />
        </Field>
      </div>
    </Modal>
  );
}
