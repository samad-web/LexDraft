// =============================================================================
// PdfPages — draws every page of a PDF onto stacked canvases with pdfjs-dist.
//
// An <iframe src=pdf> only works where the browser has a built-in PDF viewer.
// Android (the Capacitor app's WebView and mobile Chrome) has none and shows a
// blank frame, so callers use this whenever canEmbedPdf() (lib/pdf-embed) is false.
// =============================================================================

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
// Vite resolves this to a hashed asset URL; pdfjs needs its worker to parse a PDF.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  url: string;
  className?: string;
  pageClassName?: string;
  /** Shown when the PDF can't be parsed. */
  fallback?: ReactNode;
  'aria-label'?: string;
}

/** Pages are rendered once, sized to the container's width at up to 3x the
 *  screen's pixel density, so text stays sharp on phones and when the pages
 *  are zoomed in (ZoomPane). Drafts are a few pages, so all of them are drawn
 *  up front and the container scrolls. */
export function PdfPages({ url, className, pageClassName, fallback, 'aria-label': ariaLabel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';
    setError(null);

    (async () => {
      try {
        const pdf = await getDocument({ url }).promise;
        // Extra resolution for zooming in, capped so long PDFs stay light on phones.
        const dpr = Math.min(3, (window.devicePixelRatio || 1) * 2);
        for (let n = 1; n <= pdf.numPages; n += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const cssWidth = container.clientWidth || base.width;
          const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
          const canvas = document.createElement('canvas');
          if (pageClassName) canvas.className = pageClassName;
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = '100%';
          canvas.style.display = 'block';
          canvas.style.background = '#fff';
          canvas.style.marginBottom = '8px';
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
  }, [url, pageClassName]);

  if (error) return <>{fallback ?? <p className="body-md muted">Preview unavailable ({error}).</p>}</>;
  return <div ref={containerRef} className={className} aria-label={ariaLabel} />;
}
