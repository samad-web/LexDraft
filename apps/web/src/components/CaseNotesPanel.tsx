import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Icon, Select } from '@lexdraft/ui';
import type { CaseNote, CaseNoteVisibility } from '@lexdraft/types';
import {
  useCaseNotes,
  useCreateTypedNote,
  useDeleteCaseNote,
  useUpdateCaseNote,
  useUploadCaseNote,
} from '@/hooks/useCaseNotes';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { useDictation } from '@/hooks/useDictation';
import { Modal, Field } from './Modal';
import { useConfirm } from './ConfirmDialog';
import { DictateButton } from './DictateButton';

// =============================================================================
// CaseNotesPanel - inline section on CaseDetailView. Lists shared notes for
// the matter plus the viewer's own private notes, with a single "Add note"
// CTA that opens a modal supporting both typed entry and file upload.
//
// File uploads accept PDF/DOCX/TXT/MD; the server text-extracts on finalize
// and stores the result in the note body so AI drafting can pull it in.
//
// The author can edit a note in place (title + body, typing or voice) via
// PATCH /case-notes/:id - e.g. the "Case content" facts saved when the
// matter was opened.
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
    <div className="card cs-notes">
      <div className="cs-card-head">
        <div className="cs-card-titles">
          <h2 className="cs-card-title">Case facts &amp; notes</h2>
          <p className="cs-card-sub">{sharedCount} shared with the team · {privateCount} only you · AI drafting reads these</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          <Icon name="plus" size={12} /> Add note
        </button>
      </div>

      {isLoading ? (
        <p className="cs-muted">Loading notes…</p>
      ) : !notes || notes.length === 0 ? (
        <p className="cs-muted">
          Nothing written yet. Add the facts of the case, the client's account or your
          working notes - type or speak them. AI drafting uses these automatically.
        </p>
      ) : (
        <div>
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
  const update = useUpdateCaseNote(caseId);
  const canDelete = viewer?.id === note.authorId;
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');

  const startEdit = () => {
    setDraftTitle(note.title ?? '');
    setDraftBody(note.body ?? '');
    setEditing(true);
  };

  const onSave = async () => {
    if (!draftBody.trim() || update.isPending) return;
    try {
      await update.mutateAsync({
        id: note.id,
        patch: { title: draftTitle.trim(), body: draftBody.trim() },
      });
      showToast({ type: 'sage', text: 'Note updated' });
      setEditing(false);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to update note';
      showToast({ type: 'vermillion', text: msg });
    }
  };

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
    <div className="cs-note" data-last={isLast || undefined}>
      <div className="cs-note-row">
        <span className="cs-line-icon" aria-hidden="true"><Icon name={isUploaded ? 'file' : 'draft'} size={14} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="cs-note-head">
            <div className="cs-note-title">
              {note.title || (isUploaded ? note.file?.name : 'Untitled note')}
            </div>
            <VisibilityChip visibility={note.visibility} />
            {isUploaded && extractionState && extractionState !== 'ok' && (
              <ExtractionChip state={extractionState} />
            )}
          </div>
          {editing ? (
            <div className="cs-note-edit">
              <input
                className="input"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Title (optional)"
                maxLength={200}
              />
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <DictateButton
                  label="Voice note"
                  onTranscript={(t) => setDraftBody((prev) => (prev.trim() ? `${prev.trimEnd()} ${t}` : t))}
                />
              </div>
              <textarea
                className="input"
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                rows={8}
                style={{ resize: 'vertical', minHeight: 140, fontFamily: 'inherit' }}
                maxLength={50_000}
                autoFocus
              />
              <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-sm" onClick={() => setEditing(false)} disabled={update.isPending}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => { void onSave(); }}
                  disabled={update.isPending || !draftBody.trim()}
                >
                  {update.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : note.body && (
            <p className="cs-note-body">{note.body}</p>
          )}
          {isUploaded && !note.body && extractionState === 'failed' && (
            <p className="cs-note-body" style={{ fontStyle: 'italic' }}>
              {note.file?.extractionError || 'Text could not be extracted; AI drafting won’t use this note.'}
            </p>
          )}
          <div className="cs-note-meta">
            <strong>{note.authorName || 'Unknown'}</strong> · {formatTime(note.createdAt)}
          </div>
        </div>
        {canDelete && !editing && (
          <div className="cs-note-actions">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={startEdit}
              aria-label="Edit note"
              title="Edit note"
            >
              Edit
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={onDelete}
              disabled={del.isPending}
              aria-label="Delete note"
              title="Delete note"
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function VisibilityChip({ visibility }: { visibility: CaseNoteVisibility }) {
  const isPrivate = visibility === 'private';
  return (
    <span className={`cs-status ${isPrivate ? 'is-ink' : 'is-quiet'}`} style={{ height: 20, fontSize: 10.5 }}>
      {isPrivate ? 'Private' : 'Shared'}
    </span>
  );
}

function ExtractionChip({ state }: { state: 'pending' | 'failed' }) {
  return (
    <span className="cs-status is-strong is-dashed" style={{ height: 20, fontSize: 10.5 }}>
      {state === 'pending' ? 'Extracting text…' : 'No text extracted'}
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

  // Voice note = dictation-to-text. Each final transcript is appended to the
  // body with a leading space so successive utterances read as continuous
  // prose. Browsers without the Web Speech API report unsupported and we hide
  // the mic entirely rather than showing a dead button.
  const dictation = useDictation();
  const startDictation = () => {
    dictation.toggle((text) => {
      setBody((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
    });
  };

  const reset = () => {
    if (dictation.listening) dictation.stop();
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
      <div role="tablist" aria-label="Note source" className="cs-seg" style={{ marginBottom: 14 }}>
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
          {dictation.supported && (
            <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <button
                type="button"
                className={`btn btn-sm${dictation.listening ? ' btn-primary' : ''}`}
                onClick={startDictation}
                aria-pressed={dictation.listening}
                title={dictation.listening ? 'Stop dictation' : 'Dictate a voice note'}
              >
                <Icon name="mic" size={12} />
                {dictation.listening ? 'Listening… tap to stop' : 'Voice note'}
              </button>
              {dictation.listening && (
                <span className="cs-rec">REC</span>
              )}
            </div>
          )}
          <textarea
            className="input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Facts, theory, references, anything you'd want to recall on this matter. Or tap Voice note and speak."
            required
            rows={8}
            style={{ resize: 'vertical', minHeight: 140, fontFamily: 'inherit' }}
            maxLength={50_000}
          />
          <div className="cs-hint" style={{ textAlign: 'right' }}>
            {body.length.toLocaleString()} / 50,000 characters
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
          <div className="cs-hint">
            PDF, DOCX, TXT or MD · up to 25 MB · the text is extracted for AI drafting
          </div>
          {!fileSizeOk && (
            <div className="cs-hint is-error" role="alert">
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
    >
      {children}
    </button>
  );
}
