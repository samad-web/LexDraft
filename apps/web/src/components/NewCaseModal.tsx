import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { DatePicker, Select } from '@lexdraft/ui';
import type { Case, CaseStage, CaseStatus, CaseType } from '@lexdraft/types';
import { useCreateCase } from '@/hooks/useCases';
import { useUIStore } from '@/store/ui';

interface NewCaseModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fill the type field from the active list filter (e.g. "Civil"). */
  defaultType?: CaseType | string;
}

const TYPES: CaseType[] = ['Civil', 'Criminal', 'Commercial', 'Property', 'Banking', 'Family', 'Tax', 'Other'];
const STAGES: CaseStage[] = ['Filing', 'Summons', 'WS', 'Evidence', 'Arguments', 'Judgment', 'Appeal', 'Other'];
const STATUSES: CaseStatus[] = ['Active', 'Pending', 'Closed', 'Archived'];

function placeholderCnr(): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TEMP-${today}-${rand}`;
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function NewCaseModal({ open, onClose, defaultType }: NewCaseModalProps) {
  const navigate = useNavigate();
  const create = useCreateCase();
  const showToast = useUIStore((s) => s.showToast);

  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [court, setCourt] = useState('');
  const [cnr, setCnr] = useState('');
  const [type, setType] = useState<CaseType | string>(defaultType ?? 'Civil');
  const [stage, setStage] = useState<CaseStage | string>('Filing');
  const [status, setStatus] = useState<CaseStatus>('Active');
  const [next, setNext] = useState<string>(todayPlus(14));

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const payload: Omit<Case, 'id'> = {
      cnr: cnr.trim() || placeholderCnr(),
      title: title.trim(),
      client: client.trim(),
      court: court.trim(),
      type,
      stage,
      status,
      next,
    };
    try {
      const created = await create.mutateAsync(payload);
      showToast({ type: 'sage', text: `Case "${created.title}" created` });
      onClose();
      navigate(`/app/cases/${created.id}`);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to create case';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-case-title"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        padding: 16,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: 28,
          width: 'min(640px, 100%)',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>New matter</div>
          <h3 id="new-case-title" className="display" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Open a case file
          </h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            Required fields marked with *. Leave CNR blank to auto-generate a placeholder you can update later.
          </p>
        </div>

        <Field label="MATTER TITLE *" wide>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Mehta v. Skyline Constructions"
            required
            autoFocus
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="CLIENT *">
            <input
              className="input"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="Primary client (party we represent)"
              required
            />
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
          <Field label="CNR (optional)">
            <input
              className="input mono"
              value={cnr}
              onChange={(e) => setCnr(e.target.value)}
              placeholder={placeholderCnr()}
            />
          </Field>
          <Field label="NEXT HEARING *">
            <DatePicker value={next} onChange={setNext} />
          </Field>
          <Field label="TYPE *">
            <Select
              value={String(type)}
              onChange={(v) => setType(v as CaseType)}
              options={TYPES.map((t) => ({ value: t, label: t }))}
            />
          </Field>
          <Field label="STAGE *">
            <Select
              value={String(stage)}
              onChange={(v) => setStage(v as CaseStage)}
              options={STAGES.map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field label="STATUS *">
            <Select
              value={status}
              onChange={(v) => setStatus(v as CaseStatus)}
              options={STATUSES.map((s) => ({ value: s, label: s }))}
            />
          </Field>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Opening case…' : 'Open case file'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: wide ? '1 / -1' : undefined }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label}</span>
      {children}
    </label>
  );
}
