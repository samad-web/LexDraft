import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

// =============================================================================
// ZoomPane - lets the advocate zoom a drafted document.
//
// Android's WebView (the Capacitor app) has page pinch-zoom switched off, and
// the formatted PDF preview is drawn at exactly the pane's width, so before
// this a drafted document could not be enlarged at all. The pane adds:
//   - a small bar: zoom out, the current %, zoom in, Fit (back to 100%);
//   - two-finger pinch on touch screens;
//   - Ctrl/Cmd + mouse wheel on desktop.
// The page is laid out at the pane's width and then scaled as a whole (like a
// PDF viewer), inside a spacer sized to the scaled page so the scroller can
// pan across it - text doesn't reflow, the page simply gets bigger. PdfPages
// draws its canvases at extra resolution so text stays sharp when zoomed in.
// =============================================================================

const MIN = 0.6;
const MAX = 3;
const STEP = 0.2;
const clamp = (z: number) => Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100));

export function ZoomPane({ children, className, label = 'Document' }: {
  children: ReactNode;
  className?: string;
  /** For the controls' accessible names. */
  label?: string;
}) {
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const scrollRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Unscaled page size: width from the pane, height from the laid-out content.
  const [base, setBase] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const pane = paneRef.current;
    const content = contentRef.current;
    if (!pane || !content || typeof ResizeObserver === 'undefined') return;
    const measure = () => setBase({ w: pane.clientWidth, h: content.offsetHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    ro.observe(content);
    measure();
    return () => ro.disconnect();
  }, []);

  const set = useCallback((z: number) => setZoom(clamp(z)), []);

  // Pinch (touch) and Ctrl + wheel (desktop). Non-passive so the page itself
  // doesn't scroll or zoom while the document does.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let pinch: { dist: number; zoom: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { dist: dist(e.touches), zoom: zoomRef.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      setZoom(clamp(pinch.zoom * (dist(e.touches) / pinch.dist)));
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(clamp(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div ref={paneRef} className={`zoom-pane${className ? ` ${className}` : ''}`}>
      <div className="zoom-bar" role="toolbar" aria-label={`${label} zoom`}>
        <button type="button" className="zoom-btn" onClick={() => set(zoom - STEP)} disabled={zoom <= MIN} aria-label="Zoom out">−</button>
        <button type="button" className="zoom-level" onClick={() => set(1)} title="Fit to width" aria-label={`Zoom ${Math.round(zoom * 100)}%, reset`}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="zoom-btn" onClick={() => set(zoom + STEP)} disabled={zoom >= MAX} aria-label="Zoom in">+</button>
        <button type="button" className="zoom-fit" onClick={() => set(1)} disabled={zoom === 1}>Fit</button>
      </div>
      <div ref={scrollRef} className="zoom-scroll">
        <div className="zoom-spacer" style={base.w ? { width: base.w * zoom, height: base.h * zoom } : undefined}>
          <div
            ref={contentRef}
            className="zoom-content"
            style={{ width: base.w || '100%', transform: zoom === 1 ? undefined : `scale(${zoom})` }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
