import { useRef, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { useReadFormat, useSaveFormat, type FormatReadResult } from '@/hooks/useFirmFormats';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the new format's picker label once it is saved. */
  onSaved: (label: string) => void;
  /** Use an existing built-in format instead (when the reader finds a match). */
  onUseExisting: (label: string) => void;
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.txt,.md,application/pdf,image/png,image/jpeg,image/webp,'
  + 'application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';
const MAX_BYTES = 10 * 1024 * 1024;

function errorText(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string; error?: string; problems?: string[] } } })?.response?.data;
  if (data?.problems?.length) return data.problems.join('; ');
  return data?.message ?? data?.error ?? fallback;
}

/**
 * Upload the advocate's OWN drafting format (PDF, scan/photo, Word or text). The
 * engine's reader turns it into a template with fields; the advocate checks the
 * preview against their original and approves it. Saved formats are private to
 * the firm and appear in the format picker as "<title> (firm format)".
 */
export function UploadFormatModal({ open, onClose, onSaved, onUseExisting }: Props) {
  const read = useReadFormat();
  const save = useSaveFormat();
  const showToast = useUIStore((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement>(null);

  const [result, setResult] = useState<FormatReadResult | null>(null);
  const [title, setTitle] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setResult(null); setTitle(''); setReviewed(false); setError(null);
    read.reset(); save.reset();
  };
  const close = () => { reset(); onClose(); };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) { setError('That file is larger than 10 MB.'); return; }
    try {
      const r = await read.mutateAsync({ file, titleHint: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') });
      setResult(r);
      setTitle(r.title);
      setReviewed(false);
    } catch (err) {
      setError(errorText(err, 'Could not read that file.'));
    }
  };

  const onSave = async () => {
    if (!result) return;
    try {
      const saved = await save.mutateAsync({
        title: title.trim(),
        spec: result.spec,
        reviewNotes: result.reviewNotes,
        sourceName: result.sourceName,
        sourceSha256: result.sourceSha256,
      });
      showToast({ type: 'sage', text: 'Format saved — it is now in your format list' });
      reset();
      onSaved(saved.label);
    } catch (err) {
      setError(errorText(err, 'Could not save the format.'));
    }
  };

  const notes = result?.reviewNotes;
  const toCheck = notes?.uncertain ?? [];
  const lawUpdates = notes?.law_updates ?? [];
  const corrections = notes?.corrections ?? [];
  const canSave = Boolean(result?.ok && result.isLegalFormat && reviewed && title.trim().length >= 3 && !save.isPending);

  return (
    <Modal
      open={open}
      onClose={close}
      width={760}
      eyebrow="Your firm's formats"
      title={result ? 'Check the format before saving' : 'Upload a format'}
      description={result
        ? 'This is how DifAi read your format. Compare it with your original; anything in brackets or blank lines is filled from the case when you draft.'
        : 'Upload a format your office uses — a PDF, a scan or photo, a Word file, or text. DifAi reads it into a template, shows you a preview to check, and then drafts it from the case like any other format.'}
      footer={
        <div className="row" style={{ gap: 8, width: '100%' }}>
          {result && <button type="button" className="btn btn-ghost" onClick={reset}>Upload a different file</button>}
          <span className="spacer" style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={close}>Cancel</button>
          {result && (
            <button type="button" className="btn btn-primary" disabled={!canSave} onClick={() => { void onSave(); }}>
              {save.isPending ? 'Saving…' : 'Approve & save'}
            </button>
          )}
        </div>
      }
    >
      {error && (
        <p className="body-sm" role="alert" style={{ color: 'var(--danger)', marginBottom: 10 }}>{error}</p>
      )}

      {!result && (
        <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          {read.isPending ? (
            <>
              <span className="body-sm">Reading your format…</span>
              <span className="body-xs muted">This usually takes under a minute. Please keep this window open.</span>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>
                <Icon name="upload" size={14} aria-hidden /> Choose a file
              </button>
              <span className="body-xs muted">PDF, PNG / JPG photo or scan, Word (.docx) or text — up to 10 MB</span>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            style={{ display: 'none' }}
            onChange={(e) => { void onPickFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>
      )}

      {result && !result.isLegalFormat && (
        <p className="body-sm">
          This file doesn’t look like a drafting format. Upload the blank format (or a sample filled one) your office uses.
        </p>
      )}

      {result && result.isLegalFormat && (
        <div className="col" style={{ gap: 14 }}>
          {result.equivalent?.label && (
            <div className="card" style={{ padding: 12 }}>
              <span className="body-sm">
                DifAi already has <strong>{result.equivalent.label}</strong>, which looks like the same document.
              </span>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button type="button" className="btn btn-sm" onClick={() => { const l = result.equivalent!.label!; reset(); onUseExisting(l); }}>
                  Use {result.equivalent.label}
                </button>
                <span className="body-xs muted" style={{ alignSelf: 'center' }}>or save yours below to keep your office’s wording.</span>
              </div>
            </div>
          )}

          {!result.ok && (
            <div className="card" style={{ padding: 12 }}>
              <span className="body-sm" style={{ color: 'var(--danger)' }}>
                This format couldn’t be turned into a reliable template, so it can’t be saved. Try a clearer scan or the Word file.
              </span>
              <ul className="body-xs muted" style={{ margin: '6px 0 0 16px' }}>
                {result.problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          )}

          <Field label="FORMAT NAME" required hint="Shown in your format list">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} />
          </Field>

          {toCheck.length > 0 && (
            <div className="col" style={{ gap: 4 }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>PLEASE CHECK</span>
              <ul className="body-sm" style={{ margin: '0 0 0 16px' }}>
                {toCheck.map((u) => <li key={u}>{u}</li>)}
              </ul>
            </div>
          )}

          {(lawUpdates.length > 0 || corrections.length > 0) && (
            <details>
              <summary className="body-sm" style={{ cursor: 'pointer' }}>
                Changes made while reading ({lawUpdates.length + corrections.length})
              </summary>
              <ul className="body-xs" style={{ margin: '6px 0 0 16px' }}>
                {lawUpdates.map((u) => <li key={`l-${u.original}`}>Law updated: “{u.original}” → “{u.updated}” — {u.note}</li>)}
                {corrections.map((c) => <li key={`c-${c.original}`}>Corrected: “{c.original}” → “{c.corrected}”</li>)}
              </ul>
            </details>
          )}

          <div className="col" style={{ gap: 4 }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
              DETAILS FILLED FROM THE CASE ({result.spec.fields.length})
            </span>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {result.spec.fields.map((f) => (
                <span key={f.key} className="badge">{f.label || f.key}{f.required ? ' *' : ''}</span>
              ))}
            </div>
            <span className="body-xs muted">* needed before the document can be drafted</span>
          </div>

          {result.preview.length > 0 && (
            <div className="col" style={{ gap: 4 }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
                PREVIEW WITH SAMPLE DETAILS
              </span>
              <div
                className="card"
                style={{ padding: 16, maxHeight: 340, overflowY: 'auto', fontFamily: 'var(--font-serif, Georgia, serif)', fontSize: 13, lineHeight: 1.55 }}
              >
                {result.preview.map((line, i) => (
                  <p key={i} style={{ margin: line.trim() ? '0 0 6px' : '0 0 10px' }}>{line || ' '}</p>
                ))}
              </div>
            </div>
          )}

          {result.ok && (
            <label className="row body-sm" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} style={{ marginTop: 3 }} />
              <span>I have checked this preview against our original format and it is correct to use for drafting.</span>
            </label>
          )}
        </div>
      )}
    </Modal>
  );
}
