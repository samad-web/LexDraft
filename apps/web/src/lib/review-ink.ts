// review-copy: the pen and note logic of the Review page, kept free of the DOM so
// it can be tested. Coordinates are page-relative (0-1, top-left origin) so marks
// stay put on any screen size or device.

export type Ink = 'black' | 'blue' | 'red' | 'yellow';
export type Tool = 'pen' | 'hl' | 'eraser' | 'note';
export interface Stroke { tool: 'pen' | 'hl'; color: Ink; w: number; pts: Array<[number, number]> }
export interface Marks { pages: Array<{ strokes: Stroke[] }> }
export interface ReviewNote {
  id: string; page: number; x: number; y: number; text: string; excerpt: string;
  /** team-docs: ticked Done by (server-set). */
  done?: { by: string; name: string; at: string } | null;
  replies?: Array<{ by: string; name: string; text: string; at: string }>;
}
export interface ReviewState { marks: Marks; notes: ReviewNote[] }

export const INK_CSS: Record<Ink, string> = { black: '#121212', blue: '#1a4dd9', red: '#d91a1a', yellow: '#ffd91a' };
/** Stroke widths, relative to the page's width. */
export const WIDTH = { pen: 0.0025, hl: 0.018 } as const;
export const MAX_POINTS = 2000;

/** Palm rejection. A pen (Apple Pencil, stylus) or a mouse always draws. A finger
 *  draws only when the advocate turned on "Draw with finger", and never once a
 *  pen has been used on this page (a resting palm is a finger touch). */
export function shouldDraw(pointerType: string, opts: { fingerDraw: boolean; penSeen: boolean }): boolean {
  if (pointerType === 'pen' || pointerType === 'mouse') return true;
  return pointerType === 'touch' && opts.fingerDraw && !opts.penSeen;
}

/** Safari reports the Apple Pencil as a Touch with touchType "stylus". Cancelling
 *  only those touches stops the Pencil from scrolling while fingers still scroll. */
export function hasStylusTouch(touches: ArrayLike<{ touchType?: string }>): boolean {
  for (let i = 0; i < touches.length; i++) if (touches[i]!.touchType === 'stylus') return true;
  return false;
}

export function toPagePoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): [number, number] {
  const c = (n: number) => Math.min(1, Math.max(0, n));
  return [c((clientX - rect.left) / rect.width), c((clientY - rect.top) / rect.height)];
}

/** Append a point unless it is within ~0.5 px of the last one (keeps strokes
 *  under MAX_POINTS on a long scribble). */
export function addPoint(pts: Array<[number, number]>, p: [number, number], pageWidthPx: number): boolean {
  const last = pts[pts.length - 1];
  if (pts.length >= MAX_POINTS) return false;
  if (last && Math.hypot((p[0] - last[0]) * pageWidthPx, (p[1] - last[1]) * pageWidthPx) < 0.5) return false;
  pts.push(p);
  return true;
}

/** Eraser: the index of the top-most stroke within `tolPx` of the point, else -1.
 *  `aspect` = page height / width, so distances are measured on the real page. */
export function hitStroke(strokes: readonly Stroke[], p: [number, number], widthPx: number, aspect: number, tolPx = 10): number {
  const P = [p[0] * widthPx, p[1] * widthPx * aspect];
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i]!;
    const tol = tolPx + (s.w * widthPx) / 2;
    const q = s.pts.map(([x, y]) => [x * widthPx, y * widthPx * aspect]);
    if (q.length === 1 && Math.hypot(P[0]! - q[0]![0]!, P[1]! - q[0]![1]!) <= tol) return i;
    for (let k = 1; k < q.length; k++) {
      if (segDist(P as [number, number], q[k - 1] as [number, number], q[k] as [number, number]) <= tol) return i;
    }
  }
  return -1;
}

function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function withStroke(state: ReviewState, page: number, stroke: Stroke): ReviewState {
  const pages = state.marks.pages.slice();
  while (pages.length <= page) pages.push({ strokes: [] });
  pages[page] = { strokes: [...pages[page]!.strokes, stroke] };
  return { ...state, marks: { pages } };
}

export function withoutStroke(state: ReviewState, page: number, index: number): ReviewState {
  const pages = state.marks.pages.slice();
  if (!pages[page]) return state;
  pages[page] = { strokes: pages[page]!.strokes.filter((_, i) => i !== index) };
  return { ...state, marks: { pages } };
}

/** Undo / redo over whole states (marks + notes), capped at 100 steps. */
export interface History { past: ReviewState[]; present: ReviewState; future: ReviewState[] }
export const startHistory = (s: ReviewState): History => ({ past: [], present: s, future: [] });
export const commit = (h: History, next: ReviewState): History =>
  ({ past: [...h.past, h.present].slice(-100), present: next, future: [] });
export const undo = (h: History): History =>
  (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] } : h);
export const redo = (h: History): History =>
  (h.future.length ? { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) } : h);

/** The printed line at a tapped height: text items within half a line of `y`
 *  (page-relative, top origin), left to right. Used as a note's anchor and to
 *  find the paragraph for Redraft. */
export function excerptAt(items: ReadonlyArray<{ str: string; x: number; y: number }>, y: number, tol = 0.012): string {
  return items.filter((i) => Math.abs(i.y - y) <= tol && i.str.trim())
    .sort((a, b) => a.x - b.x).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** The draft paragraph a note's excerpt came from (for Redraft's focus), or -1. */
export function paragraphOf(paragraphs: readonly string[], excerpt: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const e = norm(excerpt);
  if (e.length < 6) return -1;
  const probe = e.split(' ').slice(0, 8).join(' ');
  return paragraphs.findIndex((p) => norm(p).includes(probe));
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[], w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  for (const s of strokes) drawStroke(ctx, s, w, h);
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK_CSS[s.color];
  ctx.globalAlpha = s.tool === 'hl' ? 0.35 : 1;
  ctx.lineWidth = Math.max(1, s.w * w);
  ctx.beginPath();
  s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
  if (s.pts.length === 1) ctx.lineTo(s.pts[0]![0] * w + 0.01, s.pts[0]![1] * h);
  ctx.stroke();
  ctx.restore();
}
