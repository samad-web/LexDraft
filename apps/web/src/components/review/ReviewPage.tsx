import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import {
  addPoint, drawStroke, drawStrokes, excerptAt, hasStylusTouch, hitStroke, shouldDraw, toPagePoint,
  WIDTH, type Ink, type ReviewNote, type Stroke, type Tool,
} from '@/lib/review-ink';

// Safari (iPad) tells the Apple Pencil apart on touch events, so the Pencil can be
// kept from scrolling while fingers scroll natively. Elsewhere (Android stylus),
// once a pen is seen the layer takes all touches and fingers scroll by hand.
const SAFARI_STYLUS = typeof Touch !== 'undefined' && 'touchType' in Touch.prototype;

interface Props {
  page: PDFPageProxy;
  index: number;
  width: number;
  strokes: Stroke[];
  notes: Array<ReviewNote & { number: number }>;
  tool: Tool;
  color: Ink;
  canEdit: boolean;
  fingerDraw: boolean;
  scroller: HTMLElement | null;
  onStroke: (s: Stroke) => void;
  onErase: (strokeIndex: number) => void;
  onAddNote: (n: { x: number; y: number; excerpt: string }) => void;
  onOpenNote: (id: string) => void;
}

export function ReviewPage(p: Props) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ id: number; pts: Array<[number, number]> } | null>(null);
  const panning = useRef<{ id: number; x: number; y: number } | null>(null);
  const textItems = useRef<Array<{ str: string; x: number; y: number }> | null>(null);
  const [penSeen, setPenSeen] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0, px: 1 });

  // The page itself, sharp at the screen's pixel density.
  useEffect(() => {
    let cancelled = false;
    const base = p.page.getViewport({ scale: 1 });
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const scale = p.width / base.width;
    const vp = p.page.getViewport({ scale: scale * dpr });
    const canvas = baseRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const task = p.page.render({ canvasContext: ctx, viewport: vp });
    task.promise.catch(() => {});
    if (!cancelled) setSize({ w: p.width, h: (base.height / base.width) * p.width, px: dpr });
    return () => { cancelled = true; task.cancel(); };
  }, [p.page, p.width]);

  // The ink layer: every saved stroke, redrawn when they change or on resize.
  useEffect(() => {
    const c = inkRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !size.w) return;
    c.width = Math.floor(size.w * size.px);
    c.height = Math.floor(size.h * size.px);
    drawStrokes(ctx, p.strokes, c.width, c.height);
  }, [p.strokes, size]);

  // Keep the Apple Pencil from scrolling (fingers still scroll).
  useEffect(() => {
    const c = inkRef.current;
    if (!c || !p.canEdit) return;
    const stop = (e: TouchEvent) => { if (hasStylusTouch(e.touches as unknown as ArrayLike<{ touchType?: string }>) && p.tool !== 'note') e.preventDefault(); };
    c.addEventListener('touchstart', stop, { passive: false });
    c.addEventListener('touchmove', stop, { passive: false });
    return () => { c.removeEventListener('touchstart', stop); c.removeEventListener('touchmove', stop); };
  }, [p.canEdit, p.tool]);

  const takesAllTouches = p.canEdit && p.tool !== 'note' && (p.fingerDraw || (!SAFARI_STYLUS && penSeen));

  const excerpt = async (y: number) => {
    if (!textItems.current) {
      const vp = p.page.getViewport({ scale: 1 });
      const tc = await p.page.getTextContent();
      textItems.current = tc.items.flatMap((it) => {
        if (!('str' in it)) return [];
        const [x, yy] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        return [{ str: it.str, x: x / vp.width, y: (yy - (it.height || 0) / 2) / vp.height }];
      });
    }
    return excerptAt(textItems.current, y);
  };

  const rect = () => inkRef.current!.getBoundingClientRect();

  const down = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!p.canEdit) return;
    const pt = toPagePoint(e.clientX, e.clientY, rect());
    if (p.tool === 'note') {
      void excerpt(pt[1]).then((ex) => p.onAddNote({ x: pt[0], y: pt[1], excerpt: ex }));
      return;
    }
    if (e.pointerType === 'pen' && !penSeen) setPenSeen(true);
    if (!shouldDraw(e.pointerType, { fingerDraw: p.fingerDraw, penSeen: penSeen || e.pointerType === 'pen' })) {
      if (takesAllTouches && e.pointerType === 'touch') panning.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    e.preventDefault();
    // Keep the stroke if the pen leaves the canvas. Some browsers refuse capture
    // for a pointer that has already lifted; that must not stop the stroke.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (p.tool === 'eraser') {
      erase(pt);
      drawing.current = { id: e.pointerId, pts: [] };
      return;
    }
    drawing.current = { id: e.pointerId, pts: [pt] };
  };

  const erase = (pt: [number, number]) => {
    const hit = hitStroke(p.strokes, pt, size.w, size.h / size.w);
    if (hit >= 0) p.onErase(hit);
  };

  const move = (e: RPointerEvent<HTMLCanvasElement>) => {
    const pan = panning.current;
    if (pan && pan.id === e.pointerId) {
      p.scroller?.scrollBy(pan.x - e.clientX, pan.y - e.clientY);
      panning.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    const r = rect();
    // The pen's in-between positions, for smooth lines. Some browsers return an
    // empty list; then this event alone is the point (else the line is lost).
    const coalesced = e.nativeEvent.getCoalescedEvents?.();
    const events = (coalesced?.length ? coalesced : [e.nativeEvent]) as PointerEvent[];
    if (p.tool === 'eraser') { erase(toPagePoint(e.clientX, e.clientY, r)); return; }
    const ctx = inkRef.current!.getContext('2d')!;
    const tool = p.tool === 'hl' ? 'hl' : 'pen';
    for (const ev of events) {
      const before = d.pts.length;
      if (addPoint(d.pts, toPagePoint(ev.clientX, ev.clientY, r), size.w) && before) {
        const seg: Stroke = { tool, color: p.color, w: WIDTH[tool], pts: d.pts.slice(before - 1) };
        drawStroke(ctx, seg, inkRef.current!.width, inkRef.current!.height);
      }
    }
  };

  const up = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (panning.current?.id === e.pointerId) panning.current = null;
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    drawing.current = null;
    if (p.tool === 'pen' || p.tool === 'hl') {
      p.onStroke({ tool: p.tool, color: p.color, w: WIDTH[p.tool], pts: d.pts });
    }
  };

  return (
    <div
      className="rv-page"
      style={{
        position: 'relative', width: size.w || p.width, height: size.h || undefined, margin: '0 auto 12px', background: '#fff',
        WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
      }}
      aria-label={`Page ${p.index + 1}`}
    >
      <canvas ref={baseRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <canvas
        ref={inkRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          touchAction: takesAllTouches ? 'none' : 'pan-x pan-y pinch-zoom',
          cursor: !p.canEdit ? 'default' : p.tool === 'note' ? 'copy' : p.tool === 'eraser' ? 'cell' : 'crosshair',
        }}
      />
      {p.notes.map((n) => (
        <button
          key={n.id}
          type="button"
          className="rv-pin"
          onClick={() => p.onOpenNote(n.id)}
          aria-label={`Note ${n.number}`}
          style={{
            position: 'absolute', left: `calc(${n.x * 100}% - 11px)`, top: `calc(${n.y * 100}% - 11px)`,
            width: 22, height: 22, borderRadius: '50%', background: '#fff', color: '#121212',
            border: '1.5px solid #121212', font: '700 11px/1 var(--font-sans, sans-serif)', cursor: 'pointer', padding: 0,
          }}
        >
          {n.number}
        </button>
      ))}
    </div>
  );
}
