// =============================================================================
// DraftRenderView — the SINGLE-rendering-path preview + download for an engine draft.
//
// The engine's .docx is converted to a filing PDF by a background job. This view:
//   * polls the render (useDraftRender) until ready/failed,
//   * PREVIEWS the PDF with pdfjs-dist (the same artifact that gets filed), and
//   * DOWNLOADS the .docx (the true source the advocate files).
//
// There is no client-side re-render (no jsPDF/html2canvas): what the advocate sees
// IS what they file. blocks[] are shown separately as editable display text only.
// =============================================================================

import { useDraftRender } from '@/hooks/useEngineDraft';
import { PdfPages } from '@/components/PdfPages';
import { ZoomPane } from '@/components/ZoomPane';

interface Props {
  renderId: string | null;
  /** The render status the draft response already reported, so we can show the right
   *  initial state before the first poll returns. */
  initialStatus?: 'pending' | 'ready' | 'failed' | 'unavailable';
}

export function DraftRenderView({ renderId, initialStatus }: Props) {
  const { data, isError } = useDraftRender(renderId);
  const status = data?.renderStatus ?? initialStatus ?? 'pending';

  if (!renderId || initialStatus === 'unavailable') {
    return (
      <p className="engine-panel__render-note">
        The filing copy isn’t available for this draft. The on-screen text above reflects
        the content; a downloadable copy will appear once document rendering is configured.
      </p>
    );
  }

  if (status === 'failed') {
    return (
      <div className="engine-panel__render-error" role="alert">
        <strong>Rendering the filing copy failed.</strong>
        {data?.error ? <span> {data.error}</span> : null}
        <span> The document text above is still correct; only the PDF/.docx conversion
          did not complete.</span>
      </div>
    );
  }

  if (status === 'pending' || isError) {
    return (
      <p className="engine-panel__render-note" aria-live="polite">
        Preparing the filing copy (PDF)…
      </p>
    );
  }

  // ready
  return (
    <div className="engine-panel__render">
      <div className="engine-panel__render-actions">
        {data?.docxUrl ? (
          <a className="btn btn--secondary" href={data.docxUrl} download>
            Download .docx (filing copy)
          </a>
        ) : null}
        {data?.pdfUrl ? (
          <a className="btn btn--ghost" href={data.pdfUrl} target="_blank" rel="noreferrer">
            Open PDF
          </a>
        ) : null}
      </div>
      {data?.pdfUrl ? (
        <ZoomPane label="Filing copy">
          <PdfPages
            url={data.pdfUrl}
            className="engine-panel__pdf"
            pageClassName="engine-panel__pdf-page"
            aria-label="Filing copy preview"
            fallback={<p className="engine-panel__render-note">Preview unavailable. Use “Open PDF”.</p>}
          />
        </ZoomPane>
      ) : null}
    </div>
  );
}

