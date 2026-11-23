import { useRef, useState, type FormEvent } from 'react';
import { Icon } from '@lexdraft/ui';
import { useCases } from '@/hooks/useCases';
import { useOpenDocument, type OpenedDocument } from '@/hooks/useImportedDocs';
import { DOC_TYPES, IMPORT_ACCEPT, MAX_IMPORT_BYTES, importErrorText } from '@/lib/imported-docs';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-picked case title ('' = No case). */
  defaultCase?: string;
  onOpened: (doc: OpenedDocument) => void;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = typeof r.result === 'string' ? r.result : '';
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error ?? new Error('File read failed'));
    r.readAsDataURL(file);
  });
}

/** Draft page "Open a document": the advocate's own Word/PDF file, for a case or
 *  no case, opened in the editor (import-edit-document). Opening is free. */
export function OpenDocumentModal({ open, onClose, defaultCase = '', onOpened }: Props) {
  const cases = useCases(undefined, { enabled: open });
  const openDoc = useOpenDocument();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [matter, setMatter] = useState(defaultCase);
  const [docType, setDocType] = useState<string>('Other');
  const [error, setError] = useState<string | null>(null);

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!/\.(docx|doc|pdf)$/i.test(f.name)) { setError(importErrorText('unsupported')); return; }
    if (f.size > MAX_IMPORT_BYTES) { setError(importErrorText('too_large')); return; }
    setFile(f);
  };

  const close = () => {
    setFile(null);
    setError(null);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) { setError('Choose a file to open.'); return; }
    setError(null);
    try {
      const doc = await openDoc.mutateAsync({ fileName: file.name, fileBase64: await toBase64(file), matter, docType });
      setFile(null);
      onOpened(doc);
      onClose();
    } catch (err) {
      setError(importErrorText((err as Error).message));
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      eyebrow="Your own document"
      title="Open a document"
      description="Open a Word or PDF file you drafted outside DifAi and edit it here. Your file is kept as it is; edits are saved as a separate copy. Opening and editing use no credits."
      onSubmit={submit}
      width={560}
      footer={
        <>
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={openDoc.isPending || !file}>
            {openDoc.isPending ? 'Opening…' : 'Open in editor'}
          </button>
        </>
      }
    >
      <Field label="FILE" required wide hint="Word (.docx, .doc) or PDF, up to 8 MB">
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
            <Icon name="upload" size={14} /> {file ? 'Choose another file' : 'Choose file'}
          </button>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file?.name}>
            {file ? file.name : 'No file chosen'}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept={IMPORT_ACCEPT}
            aria-label="Document file"
            style={{ display: 'none' }}
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </div>
      </Field>
      <div className="form-row">
        <Field label="CASE">
          <select className="input" value={matter} onChange={(e) => setMatter(e.target.value)} aria-label="Case">
            <option value="">No case (keep in My drafts)</option>
            {(cases.data ?? []).map((c) => <option key={c.id} value={c.title}>{c.title}</option>)}
          </select>
        </Field>
        <Field label="DOCUMENT TYPE">
          <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)} aria-label="Document type">
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </div>
      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--text-primary)', fontWeight: 500 }}>
          {error}
        </p>
      )}
    </Modal>
  );
}
