import { useEffect, useState, type FormEvent } from 'react';
import type { DocumentRecord } from '@lexdraft/types';
import { useUpdateDocument } from '@/hooks/useDocuments';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  doc: DocumentRecord | null;
  onClose: () => void;
}

export function EditDocumentModal({ doc, onClose }: Props) {
  const update = useUpdateDocument();
  const showToast = useUIStore((s) => s.showToast);

  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [caseLabel, setCaseLabel] = useState('');

  // Sync form state when a new document is selected for editing.
  useEffect(() => {
    if (!doc) return;
    setName(doc.name);
    setType(doc.type);
    setCaseLabel(doc.case === '-' ? '' : doc.case);
  }, [doc]);

  if (!doc) return null;

  const dirty =
    name.trim() !== doc.name ||
    type.trim() !== doc.type ||
    caseLabel.trim() !== (doc.case === '-' ? '' : doc.case);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!doc.id || !dirty) {
      onClose();
      return;
    }
    const patch: { name?: string; type?: string; case?: string } = {};
    if (name.trim() !== doc.name) patch.name = name.trim();
    if (type.trim() !== doc.type) patch.type = type.trim();
    const nextCase = caseLabel.trim();
    if (nextCase !== (doc.case === '-' ? '' : doc.case)) patch.case = nextCase || '-';
    try {
      await update.mutateAsync({ id: doc.id, patch });
      showToast({ type: 'sage', text: `Updated "${patch.name ?? doc.name}"` });
      onClose();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Could not update document';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={!!doc}
      onClose={onClose}
      eyebrow="Edit document"
      title="Edit document"
      description="Update the filename, classification, or linked matter. The attached file is unchanged."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={update.isPending || !dirty || !name.trim() || !type.trim()}
          >
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <Field label="DOCUMENT NAME" required wide>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Plaint - Mehta v. Skyline.pdf"
          required
          autoFocus
        />
      </Field>
      <div className="form-row">
        <Field label="TYPE" required>
          <input
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="e.g. Plaint, Notice, Affidavit"
            required
          />
        </Field>
        <Field label="MATTER" hint="Optional">
          <input
            className="input"
            value={caseLabel}
            onChange={(e) => setCaseLabel(e.target.value)}
            placeholder="Tag to a matter"
          />
        </Field>
      </div>
    </Modal>
  );
}
