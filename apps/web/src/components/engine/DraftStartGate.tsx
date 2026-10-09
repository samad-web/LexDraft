// =============================================================================
// DraftStartGate — the DraftBot-style "Start drafting by" entry choice.
//
// Before the advocate is dropped into the conversation, they pick HOW they want
// to begin, exactly like draftbotpro.com's modal:
//
//   • Uploading reference documents — attach the cheque / memo / invoice / a
//     prior draft; the engine reads them and drafts from what it finds.
//   • Typing facts of the matter — describe the parties, dates, amounts in
//     plain words; the engine drafts from that.
//
// Either choice hands control to the SAME IntakePanel below, primed for that
// path (file picker open, or textarea focused). This is purely the front door —
// no model call happens here; picking a mode just reveals the right surface.
// =============================================================================

interface Props {
  /** The format being drafted (or null while auto-detecting from the content). */
  activeLabel: string | null;
  /** Begin by uploading reference documents (opens the attach picker). */
  onUpload: () => void;
  /** Begin by typing the facts of the matter (focuses the composer). */
  onType: () => void;
}

export function DraftStartGate({ activeLabel, onUpload, onType }: Props) {
  return (
    <div className="draft-start-gate" role="group" aria-label="Start drafting by">
      <div className="draft-start-gate__head">
        <h2 className="draft-start-gate__title">Start drafting by</h2>
        <p className="draft-start-gate__sub">
          {activeLabel
            ? `Drafting a ${activeLabel}. Choose how you’d like to begin.`
            : 'Choose how you’d like to begin: the engine works out which document you need and drafts it.'}
        </p>
      </div>

      <div className="draft-start-gate__choices">
        <button
          type="button"
          className="draft-start-gate__choice"
          onClick={onUpload}
        >
          <span className="draft-start-gate__icon" aria-hidden>
            {/* upload glyph */}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4" />
              <path d="m7 9 5-5 5 5" />
              <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
          </span>
          <span className="draft-start-gate__label">Uploading reference documents</span>
          <span className="draft-start-gate__desc">
            Attach the cheque, memo, invoice, or an existing document. The engine
            reads them and pulls the facts into your draft.
          </span>
        </button>

        <button
          type="button"
          className="draft-start-gate__choice"
          onClick={onType}
        >
          <span className="draft-start-gate__icon" aria-hidden>
            {/* pencil glyph */}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </span>
          <span className="draft-start-gate__label">Typing facts of the matter</span>
          <span className="draft-start-gate__desc">
            Describe the parties, dates, amounts, and facts in plain language,
            and the engine drafts from what you provide.
          </span>
        </button>
      </div>
    </div>
  );
}
