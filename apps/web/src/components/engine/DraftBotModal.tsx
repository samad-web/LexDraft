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
import { contextToBriefPreamble, type DraftCaseContext } from '@/lib/draft-case-context';
import { useCreateDocument } from '@/hooks/useDocuments';
import { DictateButton } from '../DictateButton';
import { Modal } from '../Modal';

/** Best-effort document type from a filename, so a repaired upload lands with a
 *  sensible type on the case (mirrors NewCaseModal's inferDocType). */
function inferDocType(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('cheque') || n.includes('check')) return 'Cheque';
  if (n.includes('notice')) return 'Notice';
  if (n.includes('agreement') || n.includes('contract')) return 'Agreement';
  if (n.includes('invoice')) return 'Invoice';
  if (n.includes('memo')) return 'Memo';
  if (n.endsWith('.pdf')) return 'PDF document';
  return 'Document';
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Render the form directly in the page flow (a bordered card, no dialog
   *  chrome/backdrop/focus-trap) instead of inside a Modal. Used on the Draft
   *  page so case-selection and drafting live in one continuous card rather
   *  than a click-through dialog. `open` still gates submit-attempt guards
   *  (e.g. closing mid-draft), but the form is always visible while `open`. */
  inline?: boolean;
  /** The format to draft, or null to auto-detect from the prompt. */
  docLabel: string | null;
  /** Variant pre-selected from the forms library (e.g. a warrant's kind). */
  preset?: Record<string, string> | null;
  /** Fired with the drafted (or refused) state so the parent can render it. */
  onDrafted: (state: IntakeState) => void;
  /** Fired with the format the engine settled on (for the page banner/title). */
  onActiveLabel?: (label: string) => void;
  /** The format the engine settled on for the CURRENT conversation, if any —
   *  i.e. the parent's own `onActiveLabel` state echoed back. Only used by
   *  the inline banner text; the dialog variant doesn't show this line. */
  activeLabel?: string | null;
  /** When drafting FOR a case, the case's particulars. Prepended to every
   *  opening message as an authoritative fact block so the engine already
   *  knows the matter — the advocate can just say "draft a legal notice"
   *  without re-entering court/parties/CNR. */
  caseContext?: DraftCaseContext | null;
  /** Case notes/content (the advocate's typed or dictated background) folded
   *  into the brief alongside the particulars, so the engine drafts from the
   *  facts already captured on the matter. */
  caseNotes?: string[];
  /** Names of documents attached to the case whose content couldn't be read
   *  (never stored, or unextractable). Warn the advocate to re-upload them —
   *  otherwise the engine has no way to see those papers. */
  unreadableDocs?: string[];
}

const LANGUAGES = ['English', 'हिंदी (Hindi)', 'தமிழ் (Tamil)'] as const;
const LANGUAGE_SHORT: Record<string, string> = { 'English': 'English', 'हिंदी (Hindi)': 'हिंदी', 'தமிழ் (Tamil)': 'தமிழ்' };

/** Quick-start phrases. They only seed the description - the engine still
 *  detects the document type from the full text, so nothing is forced. */
const STARTERS: ReadonlyArray<{ label: string; text: string }> = [
  { label: 'Notice u/s 138 NI Act', text: 'Draft a legal notice under Section 138 of the NI Act for a dishonoured cheque.' },
  { label: 'Complaint u/s 138', text: 'Draft a complaint under Section 138 of the NI Act.' },
  { label: 'Bail application', text: 'Draft a regular bail application.' },
  { label: 'Vakalatnama', text: 'Draft a vakalatnama.' },
  { label: 'Affidavit', text: 'Draft an affidavit.' },
  { label: 'Reply to notice', text: 'Draft a reply to a legal notice received by my client.' },
];

const EXAMPLE_PLACEHOLDER =
  'e.g. My client received a dishonoured cheque and I need a legal notice under Section 138 '
  + 'of the NI Act. Describe the parties, the cheque (number, amount, date, bank), when it was '
  + 'presented and returned, and the reason for return…';

/** The human labels of the fields the engine is still asking for (outstanding),
 *  so the modal can name exactly what's missing instead of a vague prompt. */
function outstandingLabels(s: IntakeState): string[] {
  const byOutstanding = s.factSheet
    .flatMap((sec) => sec.fields)
    .filter((f) => f.outstanding)
    .map((f) => f.label);
  if (byOutstanding.length) return byOutstanding;
  // Fallback: the fact sheet didn't flag any field as outstanding (this happens
  // when the blocker is a list field like the cheque schedule, whose gap the flat
  // fact-sheet can't represent as one "outstanding" row). Surface whatever the
  // engine asked about last — the pending questions — so the advocate still gets a
  // concrete "add this" instead of a dead-end "I need a little more".
  const asked = (s.transcript ?? [])
    .filter((t) => t.role === 'assistant' && t.kind === 'question')
    .map((t) => String(t.text).trim())
    .filter(Boolean);
  // De-dupe near-identical re-asks; keep the most recent, most specific one.
  return asked.length ? [asked[asked.length - 1]!] : [];
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

export function DraftBotModal({ open, onClose, inline, docLabel, preset, onDrafted, onActiveLabel, activeLabel, caseContext, caseNotes, unreadableDocs }: Props) {
  const start = useIntakeStart();
  const startAuto = useIntakeStartAuto();
  const reply = useIntakeReply();
  const attach = useIntakeAttach();
  const draftNow = useIntakeDraftNow();
  const createDocument = useCreateDocument();

  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [language, setLanguage] = useState<string>(LANGUAGES[0]);
  const [useBns, setUseBns] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Files the advocate dropped into the "couldn't read" repair zone. They are
  // (a) fed to THIS draft immediately via the engine attach path, and (b)
  // persisted back onto the case so the byte-less rows are permanently fixed —
  // the advocate never has to leave the draft flow or touch the Documents tab.
  const [repaired, setRepaired] = useState<string[]>([]);
  const [repairBusy, setRepairBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const repairRef = useRef<HTMLInputElement>(null);

  const busy = start.isPending || startAuto.isPending || reply.isPending || attach.isPending || draftNow.isPending;

  // Prompt-strength hint, like DraftBot's "Weak Prompt: add more context".
  // When drafting FOR a case, the case's OWN papers + notes ARE the context the
  // engine drafts from (extracted server-side and folded into the brief), so a
  // short instruction like "draft a complaint u/s 138" is already a STRONG brief
  // — the advocate should not be nagged to "attach a document" the engine has.
  // Only genuinely-unreadable case docs (bytes never stored) don't count here,
  // since the engine can't read those; they're handled by the repair drop-zone.
  const usableCaseNotes = (caseNotes ?? []).filter((n) => n.trim()).length;
  const stillUnreadableCount = (unreadableDocs ?? []).filter((n) => !repaired.includes(n)).length;
  const hasCaseContext =
    !!caseContext && (usableCaseNotes > 0 || repaired.length > 0 || files.length > 0);
  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  const strength =
    hasCaseContext || files.length > 0 || words >= 40
      ? 'strong'
      : words >= 15
        ? 'ok'
        : 'weak';

  // With a case attached, the case particulars/notes ARE the substance, so a
  // short instruction like "draft a legal notice" is enough. Without a case we
  // keep the 10-char / attachment minimum so a bare click can't draft nothing.
  // A format picked from the library can be drafted with nothing typed: it
  // drafts at once with [placeholders] the Missing-details panel then fills.
  const canSubmit =
    (prompt.trim().length >= (caseContext ? 3 : 10) || files.length > 0 || !!caseContext || !!docLabel) && !busy;

  const pickFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError(null);
    const picked = Array.from(list).slice(0, 8);
    const tooBig = picked.find((f) => f.size > 8 * 1024 * 1024);
    if (tooBig) {
      setError(`"${tooBig.name}" is over 8 MB. Please attach a smaller file.`);
      return;
    }
    setFiles((prev) => [...prev, ...picked].slice(0, 8));
  };

  // Drop-here-to-fix: the advocate re-supplies a document that couldn't be read.
  // The file is (1) staged so THIS draft reads it immediately, and (2) filed
  // back onto the case (with its bytes) so it's fixed for good. Fully automatic
  // once the file is chosen — no navigating to the Documents tab.
  const repairFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError(null);
    const picked = Array.from(list).slice(0, 8);
    const tooBig = picked.find((f) => f.size > 8 * 1024 * 1024);
    if (tooBig) {
      setError(`"${tooBig.name}" is over 8 MB. Please choose a smaller file.`);
      return;
    }
    // Feed them to the current draft right away.
    setFiles((prev) => [...prev, ...picked].slice(0, 8));
    // And persist each back onto the case so the byte-less row is repaired.
    if (!caseContext?.title) {
      setRepaired((prev) => [...prev, ...picked.map((f) => f.name)]);
      return;
    }
    setRepairBusy(true);
    try {
      for (const file of picked) {
        try {
          const att = await fileToAttachment(file);
          await createDocument.mutateAsync({
            name: file.name,
            type: inferDocType(file.name),
            case: caseContext.title,
            updated: 'just now',
            fileName: file.name,
            fileMime: file.type || 'application/octet-stream',
            fileSize: file.size,
            fileBase64: att.dataBase64,
          });
          setRepaired((prev) => [...prev, file.name]);
        } catch {
          setError(`Couldn't save "${file.name}" back to the case, but it's still attached to this draft, so drafting will use it.`);
        }
      }
    } finally {
      setRepairBusy(false);
    }
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

    // When drafting FOR a case, lead the opening message with the case's
    // authoritative particulars + any notes, so the engine already knows the
    // matter. The advocate's prompt ("draft a legal notice") then only has to
    // say WHAT to draft, not re-state the facts.
    const casePreamble = caseContext ? contextToBriefPreamble(caseContext) : '';
    const notesBlock = (caseNotes ?? []).filter((n) => n.trim()).length
      ? `\n[Matter notes on record]\n${(caseNotes ?? []).filter((n) => n.trim()).join('\n\n')}`
      : '';
    const userPart = (message + bnsNote).trim();
    const opening = [casePreamble, notesBlock, userPart]
      .filter(Boolean)
      .join('\n\n')
      .trim()
      || (files.length === 0 && docLabel ? 'Draft the selected format from the details on record.' : 'I’m attaching documents for this matter.');

    try {
      // 1) Open the conversation — auto-detect the format unless one was picked.
      //    Pass the advocate's OWN instruction (`userPart`) separately so the
      //    classifier weights "draft a complaint" over any attached reference
      //    document (e.g. a s.138 NOTICE on file, whose text would otherwise
      //    dominate `opening` and mis-route the complaint back to a notice).
      let s: IntakeState = docLabel
        ? await start.mutateAsync({
            docLabel, message: opening,
            ...(preset && Object.keys(preset).length ? { preset } : {}),
          })
        : await startAuto.mutateAsync({
            message: opening,
            ...(userPart ? { instruction: userPart } : {}),
          });

      // 2) Attach any reference documents (OCR / text-extract → facts on record).
      if (files.length > 0) {
        const attachments = await Promise.all(files.map(fileToAttachment));
        s = await attach.mutateAsync({ matterId: s.matterId, docLabel: s.docLabel, files: attachments });
      }

      // 3) DRAFT NOW — the whole document, gaps as [placeholders]. No fact sheet.
      // Output language for the rendered document: map the picker's display label
      // to the engine code. Tamil renders the .docx in Tamil (see engine tamil.py);
      // English is the default. Additive — EN behaves exactly as before.
      const langCode: 'EN' | 'HI' | 'TA' = language.includes('Tamil')
        ? 'TA'
        : language.includes('Hindi')
          ? 'HI'
          : 'EN';
      s = await draftNow.mutateAsync({
        matterId: s.matterId,
        docLabel: s.docLabel,
        ...(langCode !== 'EN' ? { language: langCode } : {}),
      });
      onActiveLabel?.(s.docLabel);

      // A REFUSAL (legal hard-stop) or a still-GATHERING state means the engine
      // won't draft yet. Rather than a dead-end, tell the advocate EXACTLY which
      // legally-required facts are missing — and stay open so they can add them
      // to the prompt and Submit again. (A s.138 notice can't be drafted without
      // a real dishonour date + return reason; the engine is right to insist.)
      if (s.status === 'refused' && s.refusal) {
        // A legal HARD-STOP (e.g. a s.138 complaint can't compute its cause of action
        // without the notice-delivery date). Show the engine's reason, and — when it
        // named the implicated fields — spell out what to add, so this reads as a
        // clear "add this required fact" and not a dead end.
        const fields = (s.refusal.fields_implicated ?? []).filter(Boolean);
        const remedy =
          s.refusal.remedy_hint && s.refusal.remedy_hint !== 'none'
            ? ` ${s.refusal.remedy_hint}`
            : fields.length
              ? ` Please add: ${fields.join(', ')}, then Submit again.`
              : '';
        setError(`This can’t be drafted yet: ${s.refusal.reason}.${remedy}`);
        return;
      }
      if (s.status !== 'generated' || !s.draft) {
        const missing = outstandingLabels(s);
        // These are the facts THIS document type legally requires that weren't in
        // what was given — not a failure to read. The s.138 hint below applies ONLY
        // to the s.138 COMPLAINT (a NOTICE needs fewer facts) — it must NOT be
        // appended for other doc-types (a vakalat, deed, etc.), where it's
        // nonsensical and confusing. Match the complaint by its label.
        const isS138Complaint = /138/.test(s.docLabel ?? '') && /complaint/i.test(s.docLabel ?? '');
        const s138Hint = isS138Complaint
          ? ` (If you meant the demand NOTICE rather than the court complaint, say “draft a Notice u/s 138”; it needs fewer details.)`
          : '';
        setError(
          missing.length
            ? `To draft this ${s.docLabel}, I still need: ${missing.join(', ')}. ` +
              `These are required for this document and weren’t in what you gave me. Add them above and Submit again.` +
              s138Hint
            : 'I need a little more to draft this. Add the missing facts above and Submit again.',
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
        setError('I couldn’t tell which document you need. Just name it in your words (e.g. “a s.138 notice”, “a plaint”), then Submit.');
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

  // Case documents whose file was never stored: drop them here to feed THIS
  // draft and save them back onto the case. Shared by both layouts.
  const stillUnreadable = (unreadableDocs ?? []).filter((n) => !repaired.includes(n));
  const repairZone = !caseContext ? null : stillUnreadable.length === 0 ? (
    repaired.length > 0 ? (
      <div className="dc-notice is-ok">
        <Icon name="check" size={16} />
        <div>
          <div className="dc-notice-title">{repaired.length} document{repaired.length === 1 ? '' : 's'} added. The engine will read {repaired.length === 1 ? 'it' : 'them'}.</div>
          <div className="dc-notice-text">{repaired.join(', ')}: saved to the case and included in this draft.</div>
        </div>
      </div>
    ) : null
  ) : (
    <div className="dc-notice is-warn">
      <Icon name="flag" size={16} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="dc-notice-title">
          {stillUnreadable.length} case document{stillUnreadable.length === 1 ? ' needs its' : 's need their'} file
        </div>
        <div className="dc-notice-text">
          {stillUnreadable.join(', ')} {stillUnreadable.length === 1 ? 'is' : 'are'} on the case but the file was never stored,
          so the engine can’t read {stillUnreadable.length === 1 ? 'it' : 'them'}. Add the file here: it’s saved to the case
          and used in this draft straight away.
        </div>
        <input
          ref={repairRef}
          type="file"
          multiple
          accept="image/*,.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          style={{ display: 'none' }}
          onChange={(e) => { void repairFiles(e.target.files); e.target.value = ''; }}
        />
        <div
          role="button"
          tabIndex={0}
          className="dc-drop"
          onClick={() => { if (!repairBusy) repairRef.current?.click(); }}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !repairBusy) { e.preventDefault(); repairRef.current?.click(); } }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (!repairBusy) void repairFiles(e.dataTransfer.files); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <Icon name="upload" size={15} />
          {repairBusy ? 'Saving…' : 'Drop the file(s) here, or click to browse'}
        </div>
      </div>
    </div>
  );

  const body = (
      <div className="draftbot-modal">
        {/* Inline mode: the DraftCasePicker section directly above already
            shows the attached matter at all times, so this banner would be a
            third repetition of the same case info (picker chip → here → the
            CASE NOTES line in the strength meter below). Dialog mode keeps it
            since the advocate doesn't see the case picker while this is open. */}
        {caseContext && !inline && (
          <div
            className="card"
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '10px 12px', marginBottom: 12,
              borderLeft: '3px solid var(--success)', background: 'var(--bg-surface-2)',
            }}
          >
            <Icon name="cases" size={16} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
              <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginBottom: 2 }}>
                DRAFTING FOR THIS CASE: THE ENGINE ALREADY HAS ITS DETAILS
              </div>
              <div style={{ fontWeight: 500 }}>
                {caseContext.title}
                {caseContext.type ? ` · ${caseContext.type}` : ''}
                {caseContext.court ? ` · ${caseContext.court}` : ''}
              </div>
              {(caseNotes ?? []).filter((n) => n.trim()).length > 0 && (
                <div className="muted" style={{ fontSize: 12 }}>
                  {(caseNotes ?? []).filter((n) => n.trim()).length} note(s) from this matter will be used.
                </div>
              )}
            </div>
          </div>
        )}
        {repairZone}
        {/* Voice input — speak the instruction/facts instead of typing. The
            transcript appends to the prompt so dictation and typing mix freely. */}
        <div className="row" style={{ gap: 8, marginBottom: 8, justifyContent: 'flex-end' }}>
          <DictateButton
            onTranscript={(text) =>
              setPrompt((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text))
            }
            label="Voice note"
          />
        </div>
        <textarea
          className="draftbot-modal__prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            caseContext
              ? 'Say or type what to draft, e.g. “draft a legal notice”, “draft a plaint”. The engine uses this case’s details automatically.'
              : EXAMPLE_PLACEHOLDER
          }
          rows={6}
          disabled={busy}
          autoFocus
        />

        {/* Prompt-strength meter, like DraftBot's "Weak Prompt" hint. With a case
            attached, the engine already reads this matter's papers + notes, so we
            confirm THAT rather than nagging the advocate to attach a document it
            already has. Only when there's no case context do we fall back to the
            "add more / attach a document" nudge. */}
        <div className={`draftbot-modal__strength draftbot-modal__strength--${strength}`}>
          <span className="draftbot-modal__strength-label">
            {strength === 'weak' ? 'Weak prompt' : strength === 'ok' ? 'Good prompt' : 'Strong prompt'}
          </span>
          {hasCaseContext ? (
            <span className="draftbot-modal__strength-hint">
              {' · '}
              the engine will read this matter’s
              {usableCaseNotes > 0 ? ` ${usableCaseNotes} note/document${usableCaseNotes === 1 ? '' : 's'} on record` : ' details on record'}
              {stillUnreadableCount > 0
                ? `, though ${stillUnreadableCount} document${stillUnreadableCount === 1 ? '' : 's'} still need${stillUnreadableCount === 1 ? 's' : ''} its file (add it above)`
                : '; just say what to draft'}
            </span>
          ) : (
            strength !== 'strong' && (
              <span className="draftbot-modal__strength-hint"> · add more context (or attach a document) for a better draft</span>
            )
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
  );

  const submitLabel = busy ? 'Drafting…' : 'Submit';

  if (inline) {
    // What makes a good brief, ticked off as the advocate types. With a matter
    // attached, its particulars already cover parties / court / CNR.
    const p = prompt;
    // Read-only indicators (not buttons): each ticks itself when the text covers it.
    const checks = [
      { label: 'Document', hint: 'Name the document, e.g. legal notice, complaint, bail application',
        ok: /\b(notice|complaint|plaint|petition|application|bail|affidavit|vakalat\w*|reply|agreement|deed|appeal|suit|memo|written statement)\b/i.test(p) },
      { label: 'Parties', hint: caseContext ? 'Taken from the attached matter' : 'Who is involved, e.g. "my client X v. Y", accused, complainant',
        ok: !!caseContext || /\b(v\.?|vs\.?|versus|client|accused|complainant|petitioner|respondent|plaintiff|defendant)\b/i.test(p) },
      { label: 'Dates', hint: 'Key dates, e.g. 12/03/2026 or 12 March',
        ok: /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(p) },
      { label: 'Amounts', hint: 'Money involved, e.g. ₹2,50,000 or Rs. 50,000',
        ok: /₹|\brs\.?\s?\d|\binr\b|\b\d{1,3}(,\d{2,3})+\b|\blakh|\bcrore/i.test(p) },
    ];
    const addStarter = (text: string) =>
      setPrompt((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));

    return (
      <form className="dc-composer" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="dc-composer-head">
          <h2 className="dc-title">{activeLabel ? `Continue: ${activeLabel}` : 'What do you want to draft?'}</h2>
          <p className="dc-sub">
            Name the document and give the facts in your own words, or attach the cheque, notice or order.
            The engine writes the complete document; anything genuinely missing is left as a marked
            <code>[placeholder]</code> for you to fill.
          </p>
        </div>

        <div className="dc-starters" role="group" aria-label="Start with a document">
          <span className="dc-starters-label">Start with</span>
          {STARTERS.map((s) => (
            <button key={s.label} type="button" className="dc-starter" onClick={() => addStarter(s.text)} disabled={busy}>
              {s.label}
            </button>
          ))}
        </div>

        {repairZone}

        <div className={`dc-input${busy ? ' is-busy' : ''}`}>
          <textarea
            className="dc-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              caseContext
                ? 'Say what to draft, e.g. “a legal notice” or “a plaint”. The engine already has this matter’s details.'
                : EXAMPLE_PLACEHOLDER
            }
            rows={7}
            disabled={busy}
            autoFocus
            aria-label="Describe the document and the facts"
          />
          <div className="dc-input-bar">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display: 'none' }}
              onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }}
            />
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Icon name="upload" size={14} /> Attach
            </button>
            <DictateButton
              onTranscript={(text) => setPrompt((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text))}
              label="Dictate"
            />
            <span className="spacer" />
            <div className="dc-checks-wrap">
              <span className="dc-checks-label">Covers</span>
              <ul className="dc-checks" aria-label="What your description covers so far">
                {checks.map((c) => (
                  <li
                    key={c.label}
                    className={c.ok ? 'is-ok' : ''}
                    title={c.ok ? `${c.label}: covered` : `${c.label}: not mentioned yet. ${c.hint}`}
                  >
                    {c.ok ? <Icon name="check" size={12} /> : <span className="dc-check-ring" aria-hidden />}
                    {c.label}
                    <span className="sr-only">{c.ok ? ' (covered)' : ' (not yet)'}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {(files.length > 0 || (caseContext && usableCaseNotes > 0)) && (
          <div className="dc-files">
            {caseContext && usableCaseNotes > 0 && (
              <span className="dc-file is-case">
                <Icon name="cases" size={12} /> {usableCaseNotes} item{usableCaseNotes === 1 ? '' : 's'} from the matter
              </span>
            )}
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="dc-file">
                <Icon name="file" size={12} aria-hidden /> {f.name}
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} disabled={busy}>
                  <Icon name="close" size={12} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="dc-footer">
          <div className="dc-option">
            <span className="dc-option-label">Language</span>
            <div className="dc-seg" role="radiogroup" aria-label="Draft in">
              {LANGUAGES.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={language === l}
                  className={language === l ? 'is-on' : ''}
                  onClick={() => setLanguage(l)}
                  disabled={busy}
                >
                  {LANGUAGE_SHORT[l] ?? l}
                </button>
              ))}
            </div>
          </div>
          <label className="dc-switch">
            <input type="checkbox" checked={useBns} onChange={(e) => setUseBns(e.target.checked)} disabled={busy} />
            <span className="dc-switch-track" aria-hidden><span /></span>
            <span>
              Draft in BNS / BNSS <span className="dc-switch-hint">(2023)</span>
            </span>
          </label>
          <button type="submit" className="btn btn-primary btn-lg dc-submit" disabled={!canSubmit}>
            <Icon name="draft" size={16} /> {busy ? 'Drafting…' : 'Draft document'}
          </button>
        </div>

        {busy && <div className="dc-progress" aria-live="polite">Reading the facts and drafting the full document…</div>}
        {error && <p className="dc-error" role="alert">{error}</p>}
      </form>
    );
  }

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
            {submitLabel}
          </button>
        </>
      }
    >
      {body}
    </Modal>
  );
}
