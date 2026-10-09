// =============================================================================
// IntakePanel — the conversational intake surface (plan whole-doc).
//
// The Draft page is no longer a single "give me the complete brief" box. The
// advocate describes the matter freely; the ENGINE decides what's still missing
// (or whether it's legally sound); the MODEL only phrases the engine's questions.
// Two coordinated views of ONE IntakeState:
//
//   left  — the transcript (advocate turns + the assistant's phrased questions,
//           refusal findings, and the final draft).
//   right — the always-visible, editable fact sheet (§10), where an extraction
//           error is caught before it reaches the draft, and derived values are
//           marked (§11).
//
// Three assistant turn kinds map 1:1 to the engine's outcomes and never share a
// voice: a QUESTION (from a 422), a REFUSAL card (from refused — a finding, and
// while it stands we keep listening), and the DRAFT (from generated). This panel
// makes no model call itself — the extractor/phraser run server-side.
// =============================================================================

import { useState, useRef, useEffect } from 'react';
import { Icon } from '@lexdraft/ui';
import type { IntakeState, IntakeAttachmentFile } from '@lexdraft/types';
import {
  useIntakeStart,
  useIntakeStartAuto,
  useIntakeReply,
  useIntakeEdit,
  useIntakeAttach,
  useIntakeDraftNow,
} from '@/hooks/useIntake';
import { useEngineSignOff } from '@/hooks/useEngineDraft';
import { RefusalMessage } from './RefusalMessage';
import { ReviewBanner } from './ReviewBanner';
import { DraftBlockText } from './DraftBlockText';
import { FactSheetView } from './FactSheetView';

interface Props {
  docLabel: string;
  /** When true (the advocate hasn't explicitly picked a format), the FIRST message
   *  auto-detects the document type from what they describe, instead of using
   *  `docLabel`. The detected format is shown for confirmation. */
  autoDetect?: boolean;
  /** Fired with the format the conversation is ACTUALLY drafting once a turn
   *  exists (may differ from `docLabel` after auto-detection), so the parent can
   *  reflect it in the banner/title. */
  onActiveLabel?: (label: string) => void;
  /** DRAFT-NOW (DraftBot-style): hand the advocate's whole content to the parent
   *  to draft the FULL document immediately (model path, [placeholders] for gaps),
   *  skipping the question loop. Fired with the accumulated content. Only used for
   *  NON-engine docs — see `engineRouted`. */
  onDraftNow?: (content: string) => void;
  /** True when the ENGINE handles this doc type. Then "Draft now" drives the
   *  engine (accurate, deterministic, no fabrication) and its draft renders
   *  inline, instead of routing to the generic model pipeline (which mangles
   *  structured facts). */
  engineRouted?: boolean;
  /** True while the parent's one-shot draft is running (shows a Drafting… state). */
  draftingNow?: boolean;
  /** How the advocate chose to begin (from the "Start drafting by" gate):
   *  'upload' pops the file picker straight away; 'type' focuses the composer.
   *  Undefined keeps the neutral behaviour (no auto-focus, no auto-picker). */
  startMode?: 'upload' | 'type';
  /** Return to the "Start drafting by" gate (only meaningful before the first turn). */
  onBack?: () => void;
  /** Show the editable fact-sheet side panel. Default FALSE — the DraftBot-style
   *  UX is content-in → document-out with no fact sheet. Set true only to bring
   *  the verify/correct panel back. */
  showFactSheet?: boolean;
}

/** Read a File into the {fileName, mime, dataBase64} shape the attach API wants. */
function fileToAttachment(file: File): Promise<IntakeAttachmentFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      // data:<mime>;base64,<data> — keep only the base64 payload.
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

export function IntakePanel({
  docLabel,
  autoDetect = false,
  onActiveLabel,
  onDraftNow,
  draftingNow = false,
  startMode,
  onBack,
  engineRouted = false,
  showFactSheet = false,
}: Props) {
  const start = useIntakeStart();
  const startAuto = useIntakeStartAuto();
  const reply = useIntakeReply();
  const edit = useIntakeEdit();
  const attach = useIntakeAttach();
  const draftNow = useIntakeDraftNow();
  const signOff = useEngineSignOff();

  const [state, setState] = useState<IntakeState | null>(null);
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [bannerText, setBannerText] = useState('');
  const [signOffError, setSignOffError] = useState<string | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Guards the start-mode effect so it fires ONCE per gate choice — otherwise
  // re-renders would keep re-popping the file dialog or stealing focus.
  const startModeHandled = useRef<string | null>(null);

  // The label the conversation is actually running for. Before the first turn it
  // is the prop; once a turn exists, the state's docLabel is authoritative (it may
  // have been auto-detected and differ from the prop).
  const activeLabel = state?.docLabel ?? docLabel;

  const busy =
    start.isPending || startAuto.isPending || reply.isPending || edit.isPending ||
    attach.isPending || draftNow.isPending;

  // Field labels for the refusal card's implicated-field chips.
  const fieldLabels: Record<string, string> = {};
  if (state) {
    for (const sec of state.factSheet) for (const f of sec.fields) fieldLabels[f.key] = f.label;
  }

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state?.transcript.length]);

  // React to the "Start drafting by" choice: 'upload' pops the file picker so the
  // advocate goes straight to attaching; 'type' focuses the composer to write.
  // Fires once per distinct choice (the guard), never before the first turn is up.
  useEffect(() => {
    if (!startMode || state) return; // only on the empty opening screen
    if (startModeHandled.current === startMode) return;
    startModeHandled.current = startMode;
    if (startMode === 'upload') {
      fileRef.current?.click();
    } else {
      textareaRef.current?.focus();
    }
  }, [startMode, state]);

  useEffect(() => {
    if (state?.status === 'generated' && state.draft) setBannerText(state.draft.signals.review_banner);
  }, [state?.status, state?.draft]);

  // Report the format actually being drafted to the parent (it may have been
  // auto-detected and differ from the docLabel prop), so the banner/title match.
  useEffect(() => {
    if (state?.docLabel) onActiveLabel?.(state.docLabel);
  }, [state?.docLabel, onActiveLabel]);

  /** Open the conversation for the first turn — auto-detecting the format from the
   *  message when the advocate hasn't picked one, else starting for `docLabel`. */
  const openConversation = async (message: string): Promise<IntakeState> => {
    if (autoDetect) {
      return startAuto.mutateAsync({ message });
    }
    return start.mutateAsync({ docLabel, message });
  };

  /** DraftBot behaviour: after content is on record, immediately draft the whole
   *  document (filling genuine gaps with [placeholders]) instead of asking. Only
   *  for the engine path. Returns the drafted state, or the given one on failure. */
  const autoDraftEngine = async (s: IntakeState): Promise<IntakeState> => {
    if (!engineRouted) return s;
    try {
      return await draftNow.mutateAsync({ matterId: s.matterId, docLabel: s.docLabel });
    } catch {
      return s; // if it can't draft yet, leave the state as-is (fact sheet shows what's missing)
    }
  };

  const send = async () => {
    const message = input.trim();
    const files = pendingFiles;
    if ((!message && files.length === 0) || busy) return;
    setSignOffError(null);
    setAttachError(null);
    setDetectError(null);

    // With attachments: the conversation must exist first (attach needs a
    // matterId). If this is the very first turn, start it (auto-detecting the
    // format when none is picked), then attach the files to it.
    if (files.length > 0) {
      try {
        const attachments = await Promise.all(files.map(fileToAttachment));
        let s = state;
        if (!s) {
          s = await openConversation(message || 'I’m attaching some documents for this matter.');
        } else if (message) {
          // A typed message alongside the files: record it as a normal reply first.
          s = await reply.mutateAsync({ matterId: s.matterId, docLabel: s.docLabel, message });
        }
        let next = await attach.mutateAsync({
          matterId: s.matterId,
          docLabel: s.docLabel,
          files: attachments,
          ...(message ? { caption: message } : {}),
        });
        // DraftBot: don't stop to ask — draft the whole document now.
        next = await autoDraftEngine(next);
        setState(next);
        setInput('');
        setPendingFiles([]);
      } catch (err) {
        setAttachError(
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
            'Could not read the attachment(s). You can type the details instead.',
        );
      }
      return;
    }

    // Text only.
    try {
      let next = state
        ? await reply.mutateAsync({ matterId: state.matterId, docLabel: state.docLabel, message })
        : await openConversation(message);
      // DraftBot: draft the whole document straight from what was said.
      next = await autoDraftEngine(next);
      setState(next);
      setInput('');
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      // A 422 doc_type_unclear from start-auto: ask the advocate to pick a format.
      if (!state && status === 422 && code === 'doc_type_unclear') {
        setDetectError(
          'I couldn’t tell which document you need from that. Add a little more, or pick a format from the Formats button above.',
        );
      } else if (status === 503 || code === 'engine_unavailable') {
        setDetectError(
          'The drafting engine isn’t reachable right now. Please make sure the engine service is running, then try again.',
        );
      } else if (status === 403 || code === 'engine_routing_not_enabled') {
        setDetectError('Engine-routed drafting isn’t enabled for your account yet.');
      } else {
        // Never fail silently — surface something actionable rather than a dead Send.
        const msg =
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (err as Error)?.message ??
          'Something went wrong. Please try again.';
        setDetectError(msg);
      }
    }
  };

  const onPickFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setAttachError(null);
    // Cap at 8 files, 8 MB each (mirrors the server limits).
    const picked = Array.from(list).slice(0, 8);
    const tooBig = picked.find((f) => f.size > 8 * 1024 * 1024);
    if (tooBig) {
      setAttachError(`"${tooBig.name}" is over 8 MB. Please attach a smaller file.`);
      return;
    }
    setPendingFiles((prev) => [...prev, ...picked].slice(0, 8));
  };

  const removePending = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  /** Build the "Draft now" brief from an intake state: the full reference-document
   *  text + captured fact-sheet values + any typed advocate turns. */
  const briefFromState = (s: IntakeState | null, typed: string): string => {
    const priorAdvocate = (s?.transcript ?? [])
      .filter((t) => t.role === 'advocate')
      .map((t) => t.text)
      .join('\n');
    const factLines = (s?.factSheet ?? [])
      .flatMap((sec) => sec.fields)
      .filter((f) => (f.value ?? '').toString().trim())
      .map((f) => `${f.label}: ${f.value}`);
    const sourceText = (s?.sourceText ?? '').trim();
    return [
      priorAdvocate,
      typed.trim(),
      ...(sourceText ? ['', 'Reference document(s):', sourceText] : []),
      ...(factLines.length ? ['', 'Details on record:', ...factLines] : []),
    ]
      .filter(Boolean)
      .join('\n')
      .trim();
  };

  /** DRAFT NOW click. The path depends on whether the ENGINE handles this doc:
   *
   *  ENGINE-ROUTED (s.138, bail, deeds…): drive the ENGINE. Upload any pending
   *  files (OCR) and/or send the typed content through the intake loop — the
   *  engine EXTRACTS the pasted document into fields and DRAFTS it accurately
   *  (never fabricating a date the document doesn't contain, never swapping the
   *  payee/drawer or mangling the amount). The engine's own draft then renders
   *  inline. We do NOT fall back to the generic model pipeline, which guesses at
   *  structured facts. If the engine still needs something, it asks — that's the
   *  correct, honest behaviour.
   *
   *  NON-ENGINE docs: hand the assembled brief to the parent's model one-shot
   *  (onDraftNow), the DraftBot-style [placeholders]-for-gaps path.
   */
  const handleDraftNowClick = async () => {
    if (busy || draftingNow) return;
    setAttachError(null);
    setDetectError(null);

    let s = state;
    const files = pendingFiles;
    // Upload any picked-but-not-yet-sent files (and record a typed note), running
    // the SAME attach path Send uses. The engine drafts inside this call.
    if (files.length > 0) {
      try {
        const attachments = await Promise.all(files.map(fileToAttachment));
        if (!s) {
          s = await openConversation(input.trim() || 'I’m attaching documents for this matter.');
        } else if (input.trim()) {
          s = await reply.mutateAsync({ matterId: s.matterId, docLabel: s.docLabel, message: input.trim() });
        }
        s = await attach.mutateAsync({
          matterId: s.matterId,
          docLabel: s.docLabel,
          files: attachments,
          ...(input.trim() ? { caption: input.trim() } : {}),
        });
        setState(s);
        setInput('');
        setPendingFiles([]);
      } catch (err) {
        setAttachError(
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
            'Could not read the attachment(s). You can type the details instead.',
        );
        return;
      }
    } else if (input.trim()) {
      // No files, just typed content: send it through the intake loop so the
      // engine extracts + drafts (or asks for what's genuinely missing).
      try {
        s = state
          ? await reply.mutateAsync({ matterId: state.matterId, docLabel: state.docLabel, message: input.trim() })
          : await openConversation(input.trim());
        setState(s);
        setInput('');
      } catch (err) {
        setDetectError(
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
            'Something went wrong drafting that. Please try again.',
        );
        return;
      }
    }

    // ENGINE PATH: now force the WHOLE document out. draftNow drafts from what's
    // on record and fills genuinely-missing required fields with [placeholders]
    // (never fabricating a fact) — so the advocate gets a complete document
    // immediately, DraftBot-style, instead of a question loop. Hard-stops still
    // block. If the engine had already generated on the send above, this is a
    // harmless no-op re-draft; if it was still gathering, this completes it.
    if (engineRouted) {
      if (!s) return; // nothing on record yet
      try {
        const drafted = await draftNow.mutateAsync({ matterId: s.matterId, docLabel: s.docLabel });
        setState(drafted);
      } catch (err) {
        setDetectError(
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
            'Could not draft that yet. Add a little more and try again.',
        );
      }
      return;
    }

    // NON-ENGINE PATH: hand the full brief to the parent's model one-shot.
    if (!onDraftNow) return;
    const content = briefFromState(s, '');
    if (content.length < 10 && !(s?.sourceText ?? '').trim()) {
      setDetectError('There isn’t enough to draft from yet. Attach a document or add a few details.');
      return;
    }
    onDraftNow(content);
  };

  const commitEdits = async (edits: Record<string, string>) => {
    if (!state || busy) return;
    setSignOffError(null);
    const next = await edit.mutateAsync({ matterId: state.matterId, docLabel: state.docLabel, edits });
    setState(next);
  };

  const doSignOff = async () => {
    if (!state || state.status !== 'generated') return;
    setSignOffError(null);
    try {
      await signOff.mutateAsync({
        docLabel: state.docLabel,
        matterId: state.matterId,
        signedOn: new Date().toISOString().slice(0, 10),
        context: {},
      });
      setBannerText(''); // clears on screen — signed off as final
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'This document can’t be marked final yet.';
      setSignOffError(msg);
    }
  };

  return (
    <div className="intake">
      <div className="intake__conversation">
        <div className="intake__transcript" aria-label="Conversation">
          {!state && (
            <>
              <p className="intake__opener">
                {startMode === 'upload'
                  ? 'Attach the cheque, memo, invoice, or an existing document. I’ll read it and pull the facts in. Add a note if you like. '
                  : 'Paste or describe the matter in your own words: the parties, dates, amounts, and facts you have. '}
                {engineRouted
                  ? 'Hit “Draft now” and the engine drafts the whole document straight away from what it reads, accurately, filling every field it can and asking only for anything genuinely missing.'
                  : onDraftNow
                    ? 'Then hit “Draft now” to draft the whole document straight away (any gaps become [placeholders] to fill), or “Send” to have me ask for anything still missing, a couple of things at a time.'
                    : autoDetect
                      ? 'I’ll work out which document you need and ask for anything it still requires.'
                      : `I’ll ask about anything the ${docLabel.toLowerCase()} still needs.`}
              </p>
              {onBack && (
                <button
                  type="button"
                  className="intake__back"
                  onClick={onBack}
                >
                  ← Change how I start
                </button>
              )}
            </>
          )}

          {/* Auto-detected format — shown once, so the advocate can confirm it or
              switch via the Formats button above. */}
          {state?.detectedDocLabel && (
            <div className="intake__detected" role="status">
              <Icon name="check" size={13} aria-hidden />
              <span>
                Drafting a <strong>{state.detectedDocLabel}</strong>
                {state.detectionConfidence === 'low' && ' (my best guess, change it from Formats above if that’s not right)'}
                .
              </span>
            </div>
          )}

          {state?.transcript.map((t, i) => {
            if (t.role === 'advocate') {
              return (
                <div key={i} className="intake__turn intake__turn--advocate">
                  <p>{t.text}</p>
                </div>
              );
            }
            // Assistant turns: a refusal renders as its card (handled below via
            // state.refusal, not here) so we skip the refusal-kind text turn to
            // avoid doubling the reason. Questions/notes/draft render as text.
            if (t.kind === 'refusal') return null;
            return (
              <div key={i} className={`intake__turn intake__turn--assistant intake__turn--${t.kind ?? 'note'}`}>
                <p>{t.text}</p>
              </div>
            );
          })}

          {/* REFUSAL — a legal finding, its own voice. While it stands we keep
              listening: the input below stays enabled so the advocate can correct
              a fact, and we re-evaluate on the next turn. */}
          {state?.status === 'refused' && state.refusal && (
            <RefusalMessage refusal={state.refusal} fieldLabels={fieldLabels} />
          )}

          {/* GENERATED — the draft, under the on-screen review banner + sign-off. */}
          {state?.status === 'generated' && state.draft && (
            <div className="intake__draft">
              <ReviewBanner
                bannerText={bannerText}
                unverifiedMarker={state.draft.signals.unverified_marker}
                canSignOff={state.draft.unfilledSlots.length === 0}
                signingOff={signOff.isPending}
                onSignOff={doSignOff}
                signOffError={signOffError}
              />
              <article className="intake__blocks" aria-label="Drafted document">
                {state.draft.blocks.map((b) => (
                  <DraftBlockText key={b.key} blockKey={b.key} text={b.text} />
                ))}
              </article>
            </div>
          )}

          <div ref={transcriptEnd} />
        </div>

        {/* The input is ALWAYS available — even after a refusal (keep listening,
            stop interrogating) — until the draft is generated. */}
        {state?.status !== 'generated' && (
          <form
            className="intake__composer"
            onSubmit={(e) => { e.preventDefault(); void send(); }}
          >
            {/* Pending attachments (session-only) — shown as removable chips before
                they're sent. Values read off them land in the fact sheet as
                'inferred' for the advocate to confirm; the engine still decides. */}
            {pendingFiles.length > 0 && (
              <div className="intake__attachments" aria-label="Attachments to send">
                {pendingFiles.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="intake__chip">
                    <Icon name="file" size={12} aria-hidden />
                    <span className="intake__chip-name">{f.name}</span>
                    <button
                      type="button"
                      className="intake__chip-remove"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => removePending(i)}
                      disabled={busy}
                    >
                      <Icon name="close" size={12} aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {attachError && <p className="intake__attach-error" role="alert">{attachError}</p>}
            {detectError && <p className="intake__attach-error" role="alert">{detectError}</p>}
            <textarea
              ref={textareaRef}
              className="intake__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
              }}
              placeholder={
                pendingFiles.length > 0
                  ? 'Add a note about these files (optional), then Send…'
                  : state?.status === 'refused'
                    ? 'Correct a detail, or add anything else, and I’ll re-check.'
                    : 'Tell me about the matter… or attach the cheque, memo, or invoice.'
              }
              rows={3}
              disabled={busy}
            />
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display: 'none' }}
              onChange={(e) => { onPickFiles(e.target.files); e.target.value = ''; }}
            />
            <div className="intake__composer-actions">
              <button
                type="button"
                className="intake__attach"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                title="Attach a cheque, memo, invoice, or document"
                aria-label="Attach files"
              >
                <Icon name="upload" size={16} aria-hidden /> Attach
              </button>
              <div className="intake__actions-right">
              {/* DRAFT NOW — draft the whole document immediately (no question
                  loop). For engine docs it drives the engine (accurate); for the
                  rest it hands the brief to the model. Shown when either path is
                  available. */}
              {(engineRouted || onDraftNow) && (() => {
                // Enabled when there is SOMETHING to draft from: typed text, a
                // picked-but-not-yet-uploaded file (handleDraftNowClick uploads +
                // OCRs it first), OR facts/source already on the state.
                const factLines = (state?.factSheet ?? [])
                  .flatMap((sec) => sec.fields)
                  .filter((f) => (f.value ?? '').toString().trim());
                const sourceText = (state?.sourceText ?? '').trim();
                const priorAdvocate = (state?.transcript ?? []).some((t) => t.role === 'advocate');
                const hasContent =
                  input.trim().length >= 10 ||
                  pendingFiles.length > 0 ||
                  sourceText.length > 0 ||
                  factLines.length > 0 ||
                  priorAdvocate;
                // Engine drafting shows through `busy` (attach/reply pending); the
                // model one-shot shows through `draftingNow`.
                const working = engineRouted ? busy : draftingNow;
                return (
                  <button
                    type="button"
                    className="intake__draft-now"
                    onClick={() => void handleDraftNowClick()}
                    disabled={busy || draftingNow || !hasContent}
                    title="Draft the whole document now from what you've written or attached"
                  >
                    <Icon name="draft" size={16} aria-hidden /> {working ? 'Drafting…' : 'Draft now'}
                  </button>
                );
              })()}
              <button
                type="submit"
                className="intake__send"
                disabled={busy || (!input.trim() && pendingFiles.length === 0)}
              >
                <Icon name="chat" size={16} aria-hidden />{' '}
                {attach.isPending ? 'Reading…' : busy ? 'Thinking…' : 'Send'}
              </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* DraftBot-style UX: NO fact sheet. Content in → document out. The advocate
          corrects any [placeholder] gaps directly in the drafted document (or
          re-runs with more detail). The engine still captures + validates the
          facts internally; they're just not surfaced as an editable side panel.
          `showFactSheet` (default false) can re-enable the panel if ever needed. */}
      {showFactSheet && state && (
        <aside className="intake__side">
          <FactSheetView
            sections={state.factSheet}
            directEntryFields={state.directEntryFields}
            onEdit={commitEdits}
            busy={busy}
          />
        </aside>
      )}
    </div>
  );
}
