import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Icon, Select } from '@lexdraft/ui';
import type { CaseNote, CaseNoteVisibility } from '@lexdraft/types';
import {
  useCaseNotes,
  useCreateTypedNote,
  useDeleteCaseNote,
  useUploadCaseNote,
} from '@/hooks/useCaseNotes';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';
import { useConfirm } from './ConfirmDialog';

// =============================================================================
// CaseNotesPanel - inline section on CaseDetailView. Lists shared notes for
// the matter plus the viewer's own private notes, with a single "Add note"
// CTA that opens a modal supporting both typed entry and file upload.
//
// File uploads accept PDF/DOCX/TXT/MD; the server text-extracts on finalize
// and stores the result in the note body so AI drafting can pull it in.
//
// Edit is intentionally not exposed in v1 - delete-and-re-add covers the
// common case and keeps the UI simple. Update is wired on the server
// (PATCH /case-notes/:id) for a later UX iteration.
// =============================================================================

const ACCEPT_MIME = '.pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_BYTES = 25 * 1024 * 1024;

interface CaseNotesPanelProps {
  caseId: string;
  matterTitle: string;
}

export function CaseNotesPanel({ caseId, matterTitle }: CaseNotesPanelProps) {
  const { data: notes, isLoading } = useCaseNotes(caseId);
  const [open, setOpen] = useState(false);

  const sharedCount = notes?.filter((n) => n.visibility === 'shared').length ?? 0;
  const privateCount = notes?.filter((n) => n.visibility === 'private').length ?? 0;

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
        <div>
          <div className="heading-md">Notes</div>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginTop: 2 }}>
            {sharedCount} SHARED · {privateCount} PRIVATE
          </div>
        </div>
        <span className="spacer" />
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          <Icon name="plus" size={12} /> Add note
        </button>
      </div>

      {isLoading ? (
        <p className="body-sm muted">Loading notes…</p>
      ) : !notes || notes.length === 0 ? (
        <p className="body-sm muted">
          No notes yet. Use notes to capture facts, working theories, witness summaries -
          anything you might want to reference later. The AI drafting flow can fold these
          in as context when generating documents for this matter.
        </p>
      ) : (
        <div className="col" style={{ gap: 0 }}>
          {notes.map((n, i) => (
            <NoteRow
              key={n.id}
              note={n}
              isLast={i === notes.length - 1}
              caseId={caseId}
            />
          ))}
        </div>
      )}

      <NewCaseNoteModal
        open={open}
        onClose={() => setOpen(false)}
        caseId={caseId}
        matterTitle={matterTitle}
      />
    </div>
  );
}

interface NoteRowProps {
  note: CaseNote;
  isLast: boolean;
  caseId: string;
}

function NoteRow({ note, isLast, caseId }: NoteRowProps) {
  const viewer = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);
  const confirm = useConfirm();
  const del = useDeleteCaseNote(caseId);
  const canDelete = viewer?.id === note.authorId;

  const isUploaded = note.source === 'uploaded';
  const extractionState = note.file?.extractionStatus;

  const onDelete = async () => {
    if (!canDelete || del.isPending) return;
    const ok = await confirm({
      title: 'Delete note?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await del.mutateAsync(note.id);
      showToast({ type: 'sage', text: 'Note deleted' });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to delete';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <div
      style={{
        padding: '14px 0',
        borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)',
      }}
    >
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Icon name={isUploaded ? 'file' : 'draft'} size={14} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {note.title || (isUploaded ? note.file?.name : 'Untitled note')}
            </div>
            <VisibilityChip visibility={note.visibility} />
            {isUploaded && extractionState && extractionState !== 'ok' && (
              <ExtractionChip state={extractionState} />
            )}
          </div>
          {note.body && (
            <p
              className="body-sm muted"
              style={{
                margin: '4px 0 0',
                whiteSpace: 'pre-wrap',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {note.body}
            </p>
          )}
          {isUploaded && !note.body && extractionState === 'failed' && (
            <p className="body-sm muted" style={{ margin: '4px 0 0', fontStyle: 'italic' }}>
              {note.file?.extractionError || 'Text could not be extracted; AI drafting won’t use this note.'}
            </p>
          )}
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginTop: 6 }}>
            {note.authorName?.toUpperCase() || 'UNKNOWN'} · {formatTime(note.createdAt)}
          </div>
        </div>
        {canDelete && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={onDelete}
            disabled={del.isPending}
            aria-label="Delete note"
            style={{ flexShrink: 0 }}
            title="Delete note"
          >
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function VisibilityChip({ visibility }: { visibility: CaseNoteVisibility }) {
  const isPrivate = visibility === 'private';
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        letterSpacing: '0.14em',
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        background: isPrivate ? 'var(--warning-bg, #fef3c7)' : 'var(--success-bg, #ecfdf5)',
        color: isPrivate ? 'var(--warning, #92400e)' : 'var(--success, #065f46)',
      }}
    >
      {isPrivate ? 'PRIVATE' : 'SHARED'}
    </span>
  );
}

function ExtractionChip({ state }: { state: 'pending' | 'failed' }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        letterSpacing: '0.14em',
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--danger-bg, #fee2e2)',
        color: 'var(--danger, #991b1b)',
      }}
    >
      {state === 'pending' ? 'EXTRACTING…' : 'NO TEXT EXTRACTED'}
    </span>
  );
}

function formatTime(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

// =============================================================================
// New-note modal. Tab between "Typed" and "Upload".
// =============================================================================

interface NewCaseNoteModalProps {
  open: boolean;
  onClose: () => void;
  caseId: string;
  matterTitle: string;
}

function NewCaseNoteModal({ open, onClose, caseId, matterTitle }: NewCaseNoteModalProps) {
  const createTyped = useCreateTypedNote(caseId);
  const uploadNote = useUploadCaseNote(caseId);
  const showToast = useUIStore((s) => s.showToast);

  const [mode, setMode] = useState<'typed' | 'upload'>('typed');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<CaseNoteVisibility>('shared');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setMode('typed');
    setTitle('');
    setBody('');
    setVisibility('shared');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const fileSizeOk = useMemo(() => !file || file.size <= MAX_BYTES, [file]);
  const submitting = createTyped.isPending || uploadNote.isPending;
  const submitDisabled = submitting
    || (mode === 'typed' ? body.trim().length === 0 : !file || !fileSizeOk);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitDisabled) return;
    try {
      if (mode === 'typed') {
        await createTyped.mutateAsync({
          ...(title.trim() ? { title: title.trim() } : {}),
          body: body.trim(),
          visibility,
        });
        showToast({ type: 'sage', text: 'Note saved' });
      } else if (file) {
        const result = await uploadNote.mutateAsync({
          file,
          ...(title.trim() ? { title: title.trim() } : {}),
          visibility,
        });
        if (result.file?.extractionStatus === 'failed') {
          showToast({
            type: 'amber',
            text: 'Uploaded - but text extraction failed. AI drafting won’t see this note.',
          });
        } else {
          showToast({ type: 'sage', text: 'Note uploaded' });
        }
      }
      reset();
      onClose();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to save note';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      eyebrow="New note"
      title={`Add a note for ${matterTitle}`}
      description="Notes are matter-scoped. Shared notes are visible to your firm; private notes are visible only to you."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={() => { reset(); onClose(); }}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitDisabled}>
            {submitting ? 'Saving…' : mode === 'typed' ? 'Save note' : 'Upload note'}
          </button>
        </>
      }
    >
      <div
        role="tablist"
        aria-label="Note source"
        style={{
          display: 'flex',
          gap: 4,
          background: 'var(--bg-subtle, rgba(0,0,0,0.04))',
          padding: 4,
          borderRadius: 'var(--radius-md)',
          marginBottom: 14,
        }}
      >
        <ModeButton active={mode === 'typed'} onClick={() => setMode('typed')}>
          <Icon name="draft" size={12} /> Typed
        </ModeButton>
        <ModeButton active={mode === 'upload'} onClick={() => setMode('upload')}>
          <Icon name="upload" size={12} /> Upload file
        </ModeButton>
      </div>

      <Field label="TITLE (optional)" wide>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={mode === 'typed' ? 'e.g. Witness #3 - cross-exam strategy' : 'e.g. Counsel’s research memo'}
          maxLength={200}
        />
      </Field>

      {mode === 'typed' ? (
        <Field label="NOTE *" wide>
          <textarea
            className="input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Facts, theory, references, anything you'd want to recall on this matter."
            required
            rows={8}
            style={{ resize: 'vertical', minHeight: 140, fontFamily: 'inherit' }}
            maxLength={50_000}
          />
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginTop: 4 }}>
            {body.length.toLocaleString()} / 50,000 CHARS
          </div>
        </Field>
      ) : (
        <Field label="FILE *" wide>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_MIME}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
            className="input"
          />
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginTop: 4 }}>
            PDF, DOCX, TXT, MD · MAX 25MB · TEXT EXTRACTED FOR AI CONTEXT
          </div>
          {!fileSizeOk && (
            <div className="body-sm" style={{ color: 'var(--danger, #991b1b)', marginTop: 6 }}>
              File too large - maximum is 25MB.
            </div>
          )}
        </Field>
      )}

      <Field label="VISIBILITY *" wide>
        <Select
          value={visibility}
          onChange={(v) => setVisibility(v as CaseNoteVisibility)}
          options={[
            { value: 'shared', label: 'Shared - visible to the whole firm' },
            { value: 'private', label: 'Private - only you can see this' },
          ]}
        />
      </Field>
    </Modal>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        flex: 1,
        padding: '8px 12px',
        background: active ? 'var(--bg-surface, white)' : 'transparent',
        border: active ? '1px solid var(--border-default)' : '1px solid transparent',
        borderRadius: 'var(--radius-sm)',
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'background 0.12s ease',
      }}
    >
      {children}
    </button>
  );
}
