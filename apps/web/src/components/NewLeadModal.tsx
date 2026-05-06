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

const STAGES: LeadStage[] = ['new', 'qualified', 'proposal', 'won', 'lost'];

export function NewLeadModal({ open, onClose }: Props) {
  const create = useCreateLead();
  const showToast = useUIStore((s) => s.showToast);

  const [name, setName] = useState('');
  const [valueInr, setValueInr] = useState<string>('');
  const [referrer, setReferrer] = useState('');
  const [stage, setStage] = useState<LeadStage>('new');

  const reset = () => {
    setName('');
    setValueInr('');
    setReferrer('');
    setStage('new');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const value = Number(valueInr.replace(/[^0-9]/g, '')) || 0;
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        valueInr: value,
        referrer: referrer.trim(),
        stage,
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
      description="Required fields marked with *."
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
      <Field label="LEAD NAME *" wide>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. ABC Industries"
          required
          autoFocus
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="ESTIMATED VALUE (INR)">
          <input
            className="input mono tabular"
            inputMode="numeric"
            value={valueInr}
            onChange={(e) => setValueInr(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="e.g. 250000"
          />
        </Field>
        <Field label="STAGE *">
          <Select
            value={stage}
            onChange={(v) => setStage(v as LeadStage)}
            options={STAGES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
          />
        </Field>
        <Field label="REFERRER" wide>
          <input
            className="input"
            value={referrer}
            onChange={(e) => setReferrer(e.target.value)}
            placeholder="e.g. Repeat client / Senior counsel"
          />
        </Field>
      </div>
    </Modal>
  );
}
