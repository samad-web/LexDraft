import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { Icon } from '@lexdraft/ui';
import { useCreateDocument } from '@/hooks/useDocuments';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultCase?: string;
}

const MAX_FILE_BYTES = 12 * 1024 * 1024; // 12 MB binary, ~16 MB base64.
const ACCEPTED = '.pdf,.doc,.docx,.txt,.rtf,.png,.jpg,.jpeg,.tif,.tiff,.heic,.webp';

interface PickedFile {
  name: string;
  mime: string;
  size: number;
  base64: string;
}

function readFileAsBase64(file: File): Promise<PickedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not read file'));
        return;
      }
      // Strip the "data:<mime>;base64," prefix - backend stores raw base64.
      const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
      resolve({
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        base64,
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Heuristic: derive a display "type" from the original filename if the
 *  user hasn't typed one. Lets the registry rows still get a useful chip
 *  for arbitrary scanned uploads. */
function inferType(filename: string): string {
  const lower = filename.toLowerCase();
  if (/plaint/.test(lower)) return 'Plaint';
  if (/written.statement|\bws\b/.test(lower)) return 'WS';
  if (/affidavit/.test(lower)) return 'Affidavit';
  if (/notice/.test(lower)) return 'Notice';
  if (/contract|agreement|deed/.test(lower)) return 'Contract';
  if (/invoice|receipt|bill/.test(lower)) return 'Receipt';
  if (/vakalat/.test(lower)) return 'Vakalatnama';
  if (/petition/.test(lower)) return 'Petition';
  const ext = lower.match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === 'pdf') return 'PDF';
  if (ext === 'doc' || ext === 'docx') return 'Word document';
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp' || ext === 'heic') return 'Scan';
  return 'Other';
}

export function NewDocumentModal({ open, onClose, defaultCase }: Props) {
  const create = useCreateDocument();
  const showToast = useUIStore((s) => s.showToast);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [caseLabel, setCaseLabel] = useState(defaultCase ?? '');
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [reading, setReading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const reset = () => {
    setName('');
    setType('');
    setCaseLabel(defaultCase ?? '');
    setPicked(null);
    setReading(false);
    setDragActive(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showToast({
        type: 'amber',
        text: `File too large - ${formatBytes(file.size)}. Max 12 MB.`,
      });
      return;
    }
    setReading(true);
    try {
      const data = await readFileAsBase64(file);
      setPicked(data);
      // Auto-fill empty name + type from the file metadata.
      if (!name.trim()) setName(file.name);
      if (!type.trim()) setType(inferType(file.name));
    } catch (err) {
      showToast({
        type: 'vermillion',
        text: err instanceof Error ? err.message : 'Could not read file',
      });
    } finally {
      setReading(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    void handleFile(file);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragActive) setDragActive(true);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    void handleFile(file);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const created = await create.mutateAsync({
        name: name.trim() || picked?.name || 'Untitled document',
        type: type.trim() || (picked ? inferType(picked.name) : 'Other'),
        case: caseLabel.trim(),
        updated: 'just now',
        ...(picked
          ? {
              fileName: picked.name,
              fileMime: picked.mime,
              fileSize: picked.size,
              fileBase64: picked.base64,
            }
          : {}),
      });
      showToast({
        type: 'sage',
        text: picked
          ? `Uploaded "${created.name}" (${formatBytes(picked.size)})`
          : `Document "${created.name}" added`,
      });
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

  const dropzoneStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '24px 16px',
    minHeight: 140,
    borderRadius: 'var(--radius-md)',
    border: dragActive
      ? '2px dashed var(--text-primary)'
      : '2px dashed var(--border-default)',
    background: dragActive ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    textAlign: 'center' as const,
    transition: 'border-color 150ms ease, background 150ms ease',
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Add document"
      title="Upload or register a document"
      description="Drop a file to attach a physical document, or skip the file to register metadata only."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending || reading}>
            {create.isPending ? 'Saving…' : reading ? 'Reading file…' : picked ? 'Upload document' : 'Add document'}
          </button>
        </>
      }
    >
      <Field label="FILE" wide>
        {!picked ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragEnter={onDragOver}
            onDragLeave={onDragLeave}
            style={dropzoneStyle}
          >
            <Icon name="upload" size={20} />
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
              {dragActive ? 'Drop to attach' : 'Drag a file here, or click to browse'}
            </div>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-tertiary)' }}>
              PDF · DOCX · IMAGES · UP TO 12 MB
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              style={{ display: 'none' }}
              onChange={onPick}
            />
          </div>
        ) : (
          <div
            className="row"
            style={{
              gap: 12,
              padding: '12px 14px',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-surface)',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-surface-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-primary)',
                flexShrink: 0,
              }}
            >
              <Icon name="documents" size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={picked.name}
              >
                {picked.name}
              </div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}>
                {formatBytes(picked.size)} · {picked.mime || 'unknown type'}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setPicked(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              title="Remove file"
            >
              <Icon name="close" size={12} /> Remove
            </button>
          </div>
        )}
      </Field>

      <Field label="DOCUMENT NAME *" wide>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Plaint - Mehta v. Skyline.pdf"
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
