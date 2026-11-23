import { useState, type FormEvent } from 'react';
import { useCases } from '@/hooks/useCases';
import { useCopyDraftToCase } from '@/hooks/useImportedDocs';
import { importErrorText } from '@/lib/imported-docs';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  draftId: string;
  /** The draft's own case, left out of the list. */
  currentCase?: string;
}

/** Option A (owner, 2026-11-23): the same document for another client is a
 *  SEPARATE copy (draft + its Word files) in that case, so one client's names,
 *  dates and amounts never change another client's file. */
export function CopyToCaseModal({ open, onClose, draftId, currentCase = '' }: Props) {
  const cases = useCases(undefined, { enabled: open });
  const copy = useCopyDraftToCase();
  const showToast = useUIStore((s) => s.showToast);
  const [matter, setMatter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!matter) { setError(importErrorText('case_required')); return; }
    try {
      await copy.mutateAsync({ draftId, matter });
      showToast({ type: 'sage', text: `Copied to ${matter}. Edit that copy for this client; this one stays as it is.` });
      setMatter('');
      onClose();
    } catch (err) {
      setError(importErrorText((err as Error).message));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Separate copy"
      title="Copy to another case"
      description="Makes an independent copy in the case you pick, with its own Word files. Changes to one copy never change the other."
      onSubmit={submit}
      width={520}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={copy.isPending || !matter}>
            {copy.isPending ? 'Copying…' : 'Make a copy'}
          </button>
        </>
      }
    >
      <Field label="CASE" required wide>
        <select className="input" value={matter} onChange={(e) => { setMatter(e.target.value); setError(null); }} aria-label="Case to copy to">
          <option value="">Choose a case</option>
          {(cases.data ?? []).filter((c) => c.title !== currentCase).map((c) => (
            <option key={c.id} value={c.title}>{c.title}</option>
          ))}
        </select>
      </Field>
      {error && <p role="alert" style={{ margin: 0, fontWeight: 500 }}>{error}</p>}
    </Modal>
  );
}
