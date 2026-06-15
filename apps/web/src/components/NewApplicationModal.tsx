import { useState, type FormEvent } from 'react';
import { DatePicker, Select } from '@lexdraft/ui';
import type { CaseApplication, ApplicationKind, ApplicationStatus } from '@lexdraft/types';
import { useCreateApplication, useUpdateApplication } from '@/hooks/useCaseApplications';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

export const APPLICATION_KIND_LABELS: Record<ApplicationKind, string> = {
  ia: 'Interim Application',
  appeal: 'Appeal',
  execution: 'Execution',
  review: 'Review',
  bail: 'Bail',
  other: 'Other',
};

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending: 'Pending',
  allowed: 'Allowed',
  dismissed: 'Dismissed',
  withdrawn: 'Withdrawn',
  disposed: 'Disposed',
};

const KINDS = Object.keys(APPLICATION_KIND_LABELS) as ApplicationKind[];
const STATUSES = Object.keys(APPLICATION_STATUS_LABELS) as ApplicationStatus[];

interface Props {
  open: boolean;
  onClose: () => void;
  caseId: string;
  /** When set, the modal edits this application instead of creating one. */
  existing?: CaseApplication | null;
}

export function NewApplicationModal({ open, onClose, caseId, existing }: Props) {
  const create = useCreateApplication(caseId);
  const update = useUpdateApplication(caseId);
  const showToast = useUIStore((s) => s.showToast);

  const [kind, setKind] = useState<ApplicationKind>(existing?.kind ?? 'ia');
  const [label, setLabel] = useState(existing?.label ?? '');
  const [appType, setAppType] = useState(existing?.appType ?? '');
  const [filedOn, setFiledOn] = useState(existing?.filedOn ?? '');
  const [status, setStatus] = useState<ApplicationStatus>(existing?.status ?? 'pending');
  const [orderOn, setOrderOn] = useState(existing?.orderOn ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [visibleToPortal, setVisibleToPortal] = useState(existing?.visibleToPortal ?? true);

  const isEdit = !!existing;
  const pending = create.isPending || update.isPending;

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const payload = {
      kind,
      label: label.trim() || null,
      appType: appType.trim() || null,
      filedOn: filedOn || null,
      status,
      orderOn: orderOn || null,
      notes: notes.trim() || null,
      visibleToPortal,
    };
    try {
      if (isEdit && existing) {
        await update.mutateAsync({ appId: existing.id, patch: payload });
        showToast({ type: 'sage', text: 'Application updated' });
      } else {
        await create.mutateAsync(payload);
        showToast({ type: 'sage', text: 'Application added' });
      }
      onClose();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as Error).message ?? 'Could not save application';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit application' : 'Add application'}
      eyebrow="Matter"
      description="Interim applications, appeals, execution, review or bail — each tracked with its own status."
      width={620}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add application'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <Field label="KIND" required>
          <Select
            value={kind}
            onChange={(v) => setKind(v as ApplicationKind)}
            options={KINDS.map((k) => ({ value: k, label: APPLICATION_KIND_LABELS[k] }))}
          />
        </Field>
        <Field label="NUMBER / LABEL" hint="Optional">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. IA 412/2024" maxLength={120} />
        </Field>
        <Field label="TYPE" hint="Optional">
          <input className="input" value={appType} onChange={(e) => setAppType(e.target.value)} placeholder="e.g. Stay, Condonation of delay" maxLength={120} />
        </Field>
        <Field label="STATUS" required>
          <Select
            value={status}
            onChange={(v) => setStatus(v as ApplicationStatus)}
            options={STATUSES.map((s) => ({ value: s, label: APPLICATION_STATUS_LABELS[s] }))}
          />
        </Field>
        <Field label="FILED ON" hint="Optional">
          <DatePicker value={filedOn} onChange={setFiledOn} />
        </Field>
        <Field label="ORDER ON" hint="Optional">
          <DatePicker value={orderOn} onChange={setOrderOn} />
        </Field>
      </div>

      <Field label="NOTES" wide hint="Optional">
        <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000}
                  placeholder="Brief context — relief sought, bench, outcome…" />
      </Field>

      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={visibleToPortal} onChange={(e) => setVisibleToPortal(e.target.checked)} />
        <span className="body-sm">Visible on client portal</span>
      </label>
    </Modal>
  );
}
