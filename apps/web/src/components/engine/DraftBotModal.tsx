// =============================================================================
// DraftBotModal — the DraftBot-Pro-style one-shot drafting dialog.
//
// Mirrors draftbotpro.com's entry modal: one prompt box (with a worked example),
// an Attach control for reference documents, a "Draft in" language chooser, a
// "Draft in BNS/BNSS" toggle, and Cancel / Submit. Submit drafts the WHOLE
// document straight away — NO fact sheet, NO question loop. Any genuinely-missing
// facts come back as [placeholders] the advocate fills in the editor.
//
// It drives the ENGINE (accurate, deterministic, hard-stops enforced): start-auto
// → optional attach (OCR) → draft-now. The resulting IntakeState (status
// 'generated' with a draft, or 'refused' with a finding) is handed to the parent,
// which renders it in the preview/editor.
// =============================================================================

import { useRef, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { IntakeState, IntakeAttachmentFile } from '@lexdraft/types';
import {
  useIntakeStart,
  useIntakeStartAuto,
  useIntakeReply,
  useIntakeAttach,
  useIntakeDraftNow,
} from '@/hooks/useIntake';
import { Modal } from '../Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The format to draft, or null to auto-detect from the prompt. */
  docLabel: string | null;
  /** Fired with the drafted (or refused) state so the parent can render it. */
  onDrafted: (state: IntakeState) => void;
  /** Fired with the format the engine settled on (for the page banner/title). */
  onActiveLabel?: (label: string) => void;
}

const LANGUAGES = ['English', 'हिंदी (Hindi)', 'தமிழ் (Tamil)'] as const;

const EXAMPLE_PLACEHOLDER =
  'e.g. My client received a dishonoured cheque and I need a legal notice under Section 138 '
  + 'of the NI Act. Describe the parties, the cheque (number, amount, date, bank), when it was '
  + 'presented and returned, and the reason for return…';

/** The human labels of the fields the engine is still asking for (outstanding),
 *  so the modal can name exactly what's missing instead of a vague prompt. */
function outstandingLabels(s: IntakeState): string[] {
  return s.factSheet
    .flatMap((sec) => sec.fields)
    .filter((f) => f.outstanding)
    .map((f) => f.label);
}

/** Read a File into the {fileName, mime, dataBase64} shape the attach API wants. */
function fileToAttachment(file: File): Promise<IntakeAttachmentFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve({
        fileName: file.name,
        mime: file.type || 'application/octet-stream',
        dataBase64: comma === -1 ? result : result.slice(comma + 1),
      });
    };
    reader.readAsDataURL(file);
  });
}

export function DraftBotModal({ open, onClose, docLabel, onDrafted, onActiveLabel }: Props) {
  const start = useIntakeStart();
  const startAuto = useIntakeStartAuto();
  const reply = useIntakeReply();
  const attach = useIntakeAttach();
  const draftNow = useIntakeDraftNow();

  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [language, setLanguage] = useState<string>(LANGUAGES[0]);
  const [useBns, setUseBns] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = start.isPending || startAuto.isPending || reply.isPending || attach.isPending || draftNow.isPending;

  // Prompt-strength hint, like DraftBot's "Weak Prompt: add more context".
  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  const strength = files.length > 0 || words >= 40 ? 'strong' : words >= 15 ? 'ok' : 'weak';

  const canSubmit = (prompt.trim().length >= 10 || files.length > 0) && !busy;

  const pickFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError(null);
    const picked = Array.from(list).slice(0, 8);
    const tooBig = picked.find((f) => f.size > 8 * 1024 * 1024);
    if (tooBig) {
      setError(`"${tooBig.name}" is over 8 MB — please attach a smaller file.`);
      return;
    }
    setFiles((prev) => [...prev, ...picked].slice(0, 8));
  };

  const reset = () => {
    setPrompt('');
    setFiles([]);
    setUseBns(false);
    setError(null);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    const message = prompt.trim();
    // A hint the engine folds into the brief so the model phrasing honours it.
    const bnsNote = useBns ? ' Draft using the BNS / BNSS (2023) provisions where applicable.' : '';
    const opening = (message + bnsNote).trim() || 'I’m attaching documents for this matter.';

    try {
      // 1) Open the conversation — auto-detect the format unless one was picked.
      let s: IntakeState = docLabel
        ? await start.mutateAsync({ docLabel, message: opening })
        : await startAuto.mutateAsync({ message: opening });

      // 2) Attach any reference documents (OCR / text-extract → facts on record).
      if (files.length > 0) {
        const attachments = await Promise.all(files.map(fileToAttachment));
        s = await attach.mutateAsync({ matterId: s.matterId, docLabel: s.docLabel, files: attachments });
      }

      // 3) DRAFT NOW — the whole document, gaps as [placeholders]. No fact sheet.
      s = await draftNow.mutateAsync({ matterId: s.matterId, docLabel: s.docLabel });
      onActiveLabel?.(s.docLabel);

      // A REFUSAL (legal hard-stop) or a still-GATHERING state means the engine
      // won't draft yet. Rather than a dead-end, tell the advocate EXACTLY which
      // legally-required facts are missing — and stay open so they can add them
      // to the prompt and Submit again. (A s.138 notice can't be drafted without
      // a real dishonour date + return reason; the engine is right to insist.)
      if (s.status === 'refused' && s.refusal) {
        setError(`The engine flagged a legal issue: ${s.refusal.reason}`);
        return;
      }
      if (s.status !== 'generated' || !s.draft) {
        const missing = outstandingLabels(s);
        setError(
          missing.length
            ? `Almost there — I couldn’t find these in what you gave me: ${missing.join(', ')}. Add them above and Submit again.`
            : 'I need a little more to draft this — add the missing facts above and Submit again.',
        );
        return;
      }

      onDrafted(s);
      reset();
      onClose();
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (!docLabel && status === 422 && code === 'doc_type_unclear') {
        setError('I couldn’t tell which document you need — name it (e.g. “a s.138 notice”) or pick a format, then Submit.');
      } else if (status === 503 || code === 'engine_unavailable') {
        setError('The drafting engine isn’t reachable right now. Make sure the engine service is running, then try again.');
      } else {
        setError(
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message
            ?? 'Could not draft from that. Add a little more detail and try again.',
        );
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      eyebrow="Draft"
      title="Please tell us more about what you want to draft"
      description="Include which legal document you want, and the facts of the matter. Attach the cheque, memo, invoice, or an existing document and I’ll read them."
      width={680}
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {busy ? 'Drafting…' : 'Submit'}
          </button>
        </>
      }
    >
      <div className="draftbot-modal">
        <textarea
          className="draftbot-modal__prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={EXAMPLE_PLACEHOLDER}
          rows={6}
          disabled={busy}
          autoFocus
        />

        {/* Prompt-strength meter, like DraftBot's "Weak Prompt" hint. */}
        <div className={`draftbot-modal__strength draftbot-modal__strength--${strength}`}>
          <span className="draftbot-modal__strength-label">
            {strength === 'weak' ? 'Weak prompt' : strength === 'ok' ? 'Good prompt' : 'Strong prompt'}
          </span>
          {strength !== 'strong' && (
            <span className="draftbot-modal__strength-hint"> · add more context (or attach a document) for a better draft</span>
          )}
          <span className="draftbot-modal__strength-bar" aria-hidden />
        </div>

        {/* Attachments */}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          style={{ display: 'none' }}
          onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }}
        />
        <div className="draftbot-modal__attach-row">
          <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Icon name="upload" size={14} /> Attach reference document
          </button>
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="draftbot-modal__file">
              <Icon name="file" size={12} aria-hidden /> {f.name}
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                disabled={busy}
              >
                <Icon name="close" size={12} aria-hidden />
              </button>
            </span>
          ))}
        </div>

        {/* Options row: language + BNS/BNSS */}
        <div className="draftbot-modal__options">
          <label className="draftbot-modal__field">
            <span className="draftbot-modal__field-label">Draft in</span>
            <select
              className="input"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={busy}
            >
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label className="draftbot-modal__check">
            <input type="checkbox" checked={useBns} onChange={(e) => setUseBns(e.target.checked)} disabled={busy} />
            Draft in BNS / BNSS (2023)
          </label>
        </div>

        {error && <p className="draftbot-modal__error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
