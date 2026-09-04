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

import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
// Vite resolves this to a hashed asset URL; pdfjs needs its worker to parse a PDF.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useDraftRender } from '@/hooks/useEngineDraft';

GlobalWorkerOptions.workerSrc = workerUrl;

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
      {data?.pdfUrl ? <PdfCanvas url={data.pdfUrl} /> : null}
    </div>
  );
}

/** Render every page of a PDF to stacked canvases via pdfjs. Kept deliberately small:
 *  the document is a few pages, so we render all of them once and scroll. */
function PdfCanvas({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';

    (async () => {
      try {
        const pdf = await getDocument({ url }).promise;
        for (let n = 1; n <= pdf.numPages; n += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(n);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.className = 'engine-panel__pdf-page';
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          container.appendChild(canvas);
          await page.render({ canvasContext: ctx, viewport }).promise;
        }
      } catch (err) {
        if (!cancelled) setError((err as Error)?.message ?? 'could not render PDF');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return <p className="engine-panel__render-note">Preview unavailable ({error}). Use “Open PDF”.</p>;
  }
  return <div ref={containerRef} className="engine-panel__pdf" aria-label="Filing copy preview" />;
}
