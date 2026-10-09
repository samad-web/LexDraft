import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Icon } from '@lexdraft/ui';

// =============================================================================
// FileStager - a multi-file dropzone that holds files in memory (as base64)
// until the caller is ready to upload them.
//
// Used where an upload can't happen immediately because the parent record
// doesn't exist yet - e.g. attaching documents inside the New Case modal,
// where the case (and thus its id/label) is only created on submit. The parent
// owns the StagedFile[] and uploads them once it has somewhere to file them.
// Mirrors NewDocumentModal's single-file reader, generalised to a list.
// =============================================================================

export const STAGE_MAX_FILE_BYTES = 12 * 1024 * 1024; // 12 MB, matches DocInput.
const ACCEPTED = '.pdf,.doc,.docx,.txt,.rtf,.png,.jpg,.jpeg,.tif,.tiff,.heic,.webp';

export interface StagedFile {
  name: string;
  mime: string;
  size: number;
  base64: string;
}

function readFileAsBase64(file: File): Promise<StagedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not read file'));
        return;
      }
      const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
      resolve({ name: file.name, mime: file.type || 'application/octet-stream', size: file.size, base64 });
    };
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface FileStagerProps {
  files: StagedFile[];
  onChange: (files: StagedFile[]) => void;
  /** Surfaced to the user when a file is rejected (too large / unreadable). */
  onError?: (message: string) => void;
}

export function FileStager({ files, onChange, onError }: FileStagerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [reading, setReading] = useState(false);

  const addFiles = async (list: FileList | null | undefined) => {
    if (!list || list.length === 0) return;
    setReading(true);
    const accepted: StagedFile[] = [];
    for (const file of Array.from(list)) {
      if (file.size > STAGE_MAX_FILE_BYTES) {
        onError?.(`"${file.name}" is too large (${formatBytes(file.size)}). Max 12 MB.`);
        continue;
      }
      // Skip exact dupes already staged (same name + size).
      if (files.some((f) => f.name === file.name && f.size === file.size)) continue;
      try {
        accepted.push(await readFileAsBase64(file));
      } catch {
        onError?.(`Could not read "${file.name}".`);
      }
    }
    setReading(false);
    if (accepted.length) onChange([...files, ...accepted]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    void addFiles(e.dataTransfer.files);
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => void addFiles(e.target.files);
  const removeAt = (i: number) => onChange(files.filter((_, idx) => idx !== i));

  return (
    <div className="col" style={{ gap: 10 }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!dragActive) setDragActive(true); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: '18px 16px', minHeight: 96, borderRadius: 'var(--radius-md)',
          border: dragActive ? '2px dashed var(--text-primary)' : '2px dashed var(--border-default)',
          background: dragActive ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
          color: 'var(--text-secondary)', cursor: 'pointer', textAlign: 'center',
          transition: 'border-color 150ms ease, background 150ms ease',
        }}
      >
        <Icon name="upload" size={18} />
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
          {reading ? 'Reading…' : dragActive ? 'Drop to add' : 'Drag files here, or click to browse'}
        </div>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-tertiary)' }}>
          PDF · DOCX · IMAGES · UP TO 12 MB EACH
        </div>
        <input ref={inputRef} type="file" accept={ACCEPTED} multiple style={{ display: 'none' }} onChange={onPick} />
      </div>

      {files.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          {files.map((f, i) => (
            <div
              key={`${f.name}-${f.size}-${i}`}
              className="row"
              style={{
                gap: 10, padding: '8px 12px', border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)', background: 'var(--bg-surface)', alignItems: 'center',
              }}
            >
              <Icon name="documents" size={14} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={f.name}>
                  {f.name}
                </div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{formatBytes(f.size)}</div>
              </div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeAt(i)} title="Remove">
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
