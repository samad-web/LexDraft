import { useEffect, useState, type FormEvent } from 'react';
import type { Case, PhysicalDocStatus } from '@lexdraft/types';
import { Icon } from '@lexdraft/ui';
import { useCases } from '@/hooks/useCases';
import { useCreatePhysicalDocument } from '@/hooks/usePhysicalDocuments';

interface Props {
  open: boolean;
  onClose: () => void;
}

const STATUS_OPTIONS: Array<{ value: PhysicalDocStatus; label: string }> = [
  { value: 'in_chambers', label: 'In chambers' },
  { value: 'court_file',  label: 'Court file' },
  { value: 'client',      label: 'With client' },
  { value: 'co_counsel',  label: 'With co-counsel' },
  { value: 'archive_box', label: 'Archive box' },
  { value: 'returned',    label: 'Returned' },
  { value: 'lost',        label: 'Lost' },
];

/**
 * Modal for adding a paper document to the physical-documents register.
 * The matter link is optional - pre-matter documents (e.g. an unfiled
 * vakalatnama) can be tracked too. The fileNo unique-per-firm constraint
 * surfaces as a 409 from the API; we render the message inline.
 */
export function NewPhysicalDocModal({ open, onClose }: Props) {
  const cases = useCases();
  const create = useCreatePhysicalDocument();

  const [fileNo, setFileNo] = useState('');
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState('');
  const [location, setLocation] = useState('');
  const [custodian, setCustodian] = useState('');
  const [caseId, setCaseId] = useState<string>('');
  const [status, setStatus] = useState<PhysicalDocStatus>('in_chambers');
  const [receivedAt, setReceivedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFileNo(''); setTitle(''); setDocType(''); setLocation(''); setCustodian('');
      setCaseId(''); setStatus('in_chambers'); setReceivedAt(''); setNotes('');
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!fileNo.trim() || !title.trim() || !location.trim()) {
      setError('File number, title and location are required.');
      return;
    }
    try {
      await create.mutateAsync({
        fileNo: fileNo.trim(),
        title: title.trim(),
        location: location.trim(),
        ...(docType.trim()    ? { docType: docType.trim() }       : {}),
        ...(custodian.trim()  ? { custodian: custodian.trim() }   : {}),
        ...(caseId            ? { caseId }                        : { caseId: null }),
        status,
        ...(receivedAt        ? { receivedAt }                    : {}),
        ...(notes.trim()      ? { notes: notes.trim() }           : {}),
      });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save the document.';
      setError(msg);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="phys-doc-title" style={overlay}>
      <div style={panel} className="card">
        <div className="row" style={{ alignItems: 'flex-start', marginBottom: 20, gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="fm-eyebrow">Register an original</div>
            <h2 id="phys-doc-title" className="heading-lg" style={{ marginTop: 6 }}>Add physical document</h2>
            <p className="fm-panel-sub">Record where the paper original is kept and who holds it.</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close" style={{ width: 38, padding: 0, justifyContent: 'center' }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="col" style={{ gap: 14 }}>
          <div className="form-row">
            <Field label="File number" required>
              <input className="input" value={fileNo} onChange={(e) => setFileNo(e.target.value)} required maxLength={80} />
            </Field>
            <Field label="Title" required>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={240} />
            </Field>
          </div>

          <div className="form-row">
            <Field label="Document type" hint="e.g. Original deed, Affidavit, Court order">
              <input className="input" value={docType} onChange={(e) => setDocType(e.target.value)} maxLength={80} />
            </Field>
            <Field label="Linked matter">
              <select className="input" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                <option value="">- None -</option>
                {(cases.data ?? []).map((c: Case) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="form-row">
            <Field label="Location" required hint="e.g. Cabinet B-3, Courtroom 14, Client office">
              <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} required maxLength={200} />
            </Field>
            <Field label="Custodian" hint="Who currently holds it">
              <input className="input" value={custodian} onChange={(e) => setCustodian(e.target.value)} maxLength={120} />
            </Field>
          </div>

          <div className="form-row">
            <Field label="Status">
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value as PhysicalDocStatus)}>
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Received on">
              <input type="date" className="input" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              className="input"
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>

          {error && (
            <div role="alert" className="fm-error">
              <span className="fm-error-mark" aria-hidden>!</span>
              <span>{error}</span>
            </div>
          )}

          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={create.isPending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              {create.isPending ? 'Saving…' : 'Add document'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field(props: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="col" style={{ gap: 6 }}>
      <span className="field-label">
        {props.label}{props.required && <span className="fm-req" aria-label="required">*</span>}
      </span>
      {props.children}
      {props.hint && <span className="muted" style={{ fontSize: 12 }}>{props.hint}</span>}
    </label>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'var(--scrim)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  padding: '64px 16px', zIndex: 50, overflowY: 'auto',
};
const panel: React.CSSProperties = {
  width: '100%', maxWidth: 640, padding: 24,
};
const grid: React.CSSProperties = {
  // Two columns where there's room, one on phones.
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12,
};
