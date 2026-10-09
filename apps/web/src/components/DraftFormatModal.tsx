import { useRef, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import {
  useDraftTemplates,
  useCreateDraftTemplate,
  useDeleteDraftTemplate,
  useParseTemplateFile,
  type DraftFormatTemplate,
} from '@/hooks/useDraftTemplates';
import { useEngineStatus } from '@/hooks/useEngineDraft';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The currently applied format (if any), so the list can mark it. */
  selectedId: string | null;
  /** Apply a format to the next draft — or null to draft without one. */
  onApply: (template: DraftFormatTemplate | null) => void;
}

/**
 * Manage and pick the advocate's own drafting FORMATS. Add by pasting the format
 * text (with [placeholders]) or uploading a .docx/.txt; pick one to have the
 * agent draft INTO it. Firm-scoped.
 */
export function DraftFormatModal({ open, onClose, selectedId, onApply }: Props) {
  const { data: templates = [], isLoading } = useDraftTemplates();
  const create = useCreateDraftTemplate();
  const remove = useDeleteDraftTemplate();
  const parse = useParseTemplateFile();
  // The engine's format catalogue — the real document types a saved house-style
  // format can bind to. Independent of the per-user routing flag (see the
  // `formats` field on engine/status), so the picker is populated even before
  // engine routing is switched on for this advocate.
  const engineStatus = useEngineStatus();
  const formatOptions = engineStatus.data?.formats ?? [];
  const showToast = useUIStore((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement>(null);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [docType, setDocType] = useState('');
  const [body, setBody] = useState('');
  const [source, setSource] = useState<'paste' | 'upload'>('paste');

  const resetForm = () => {
    setAdding(false); setName(''); setDocType(''); setBody(''); setSource('paste');
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { text } = await parse.mutateAsync(file);
      setBody(text);
      setSource('upload');
      if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, ''));
      setAdding(true);
      showToast({ type: 'sage', text: 'File parsed. Review and save' });
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Could not read that file';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  const onSave = async () => {
    if (!body.trim()) { showToast({ type: 'amber', text: 'The format is empty' }); return; }
    try {
      await create.mutateAsync({
        name: name.trim() || 'Untitled format',
        docType: docType.trim(),
        body: body.trim(),
        source,
      });
      showToast({ type: 'sage', text: 'Format saved' });
      resetForm();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Save failed';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="My formats"
      title="Draft into your own format"
      description="The agent fills your house style with grounded content — sections and facts stay governed by the pipeline."
      footer={<button type="button" className="btn" onClick={onClose}>Done</button>}
    >
      {/* Add / upload */}
      {!adding ? (
        <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm" onClick={() => { setAdding(true); setSource('paste'); }}>
            <Icon name="plus" size={13} /> Paste a format
          </button>
          <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={parse.isPending}>
            <Icon name="upload" size={13} /> {parse.isPending ? 'Reading…' : 'Upload .docx / .txt'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".docx,.txt,.md,.pdf,application/pdf,text/plain"
            style={{ display: 'none' }}
            onChange={(e) => { void onPickFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>
      ) : (
        <div className="card" style={{ padding: 14, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="form-row">
            <Field label="FORMAT NAME" required>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Riyaz & Associates, Bail format" autoFocus />
            </Field>
            <Field label="FOR DOC TYPE" hint="Bind this format to a document, or leave as “Any”">
              <select
                className="input"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                disabled={engineStatus.isLoading}
              >
                <option value="">Any document</option>
                {formatOptions.map((label) => (
                  <option key={label} value={label}>{label}</option>
                ))}
                {/* A pre-set value not in the current catalogue (e.g. a legacy
                    free-text tag) stays selectable so it is never silently lost. */}
                {docType && !formatOptions.includes(docType) && (
                  <option value={docType}>{docType} (legacy)</option>
                )}
              </select>
            </Field>
          </div>
          <Field label="FORMAT TEXT" hint="Use [placeholders] for particulars the agent should fill" wide>
            <textarea
              className="input"
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={'IN THE COURT OF ...\n\nApplication No. [___] of [year]\n\n[Applicant details]\n\n... your house structure and clauses ...'}
              style={{ resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </Field>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={resetForm}>Cancel</button>
            <span className="spacer" style={{ flex: 1 }} />
            <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={create.isPending || !body.trim()}>
              {create.isPending ? 'Saving…' : 'Save format'}
            </button>
          </div>
        </div>
      )}

      {/* Saved formats list */}
      <div className="col" style={{ gap: 8 }}>
        <div className="row" style={{ alignItems: 'center' }}>
          <span className="heading-sm">Saved formats</span>
          <span className="spacer" style={{ flex: 1 }} />
          {selectedId && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onApply(null)}>
              Use default skeleton
            </button>
          )}
        </div>
        {isLoading && <span className="body-sm muted">Loading…</span>}
        {!isLoading && templates.length === 0 && (
          <span className="body-sm muted">No saved formats yet. Paste or upload one above.</span>
        )}
        {templates.map((t) => (
          <div
            key={t.id}
            className="row"
            style={{
              gap: 8, alignItems: 'center', padding: '8px 10px',
              border: '1px solid', borderColor: t.id === selectedId ? 'var(--text-primary)' : 'var(--border-subtle)',
              borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)',
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 13 }}>{t.name}</div>
              <div className="body-xs muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.docType || 'Any document'} · {t.source} · {t.body.length} chars
              </div>
            </div>
            <button
              type="button"
              className={`btn btn-sm${t.id === selectedId ? ' btn-primary' : ''}`}
              onClick={() => onApply(t)}
            >
              {t.id === selectedId ? 'Applied' : 'Use this'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label={`Delete ${t.name}`}
              onClick={() => remove.mutate(t.id)}
              style={{ color: 'var(--danger)' }}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
