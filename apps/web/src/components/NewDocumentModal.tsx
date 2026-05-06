import { useState, type FormEvent } from 'react';
import { useCreateDocument } from '@/hooks/useDocuments';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultCase?: string;
}

export function NewDocumentModal({ open, onClose, defaultCase }: Props) {
  const create = useCreateDocument();
  const showToast = useUIStore((s) => s.showToast);

  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [caseLabel, setCaseLabel] = useState(defaultCase ?? '');

  const reset = () => {
    setName('');
    setType('');
    setCaseLabel(defaultCase ?? '');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        type: type.trim() || 'Other',
        case: caseLabel.trim(),
        updated: 'just now',
      });
      showToast({ type: 'sage', text: `Document "${created.name}" added` });
      reset();
      onClose();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to add document';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Add document"
      title="Register a document"
      description="Records the document's metadata in the registry. Upload of file contents is not yet supported."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Add document'}
          </button>
        </>
      }
    >
      <Field label="DOCUMENT NAME *" wide>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Plaint — Mehta v. Skyline.pdf"
          required
          autoFocus
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="TYPE *">
          <input
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="e.g. Plaint, Notice, Affidavit"
            required
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
      </div>
    </Modal>
  );
}
