import { describe, expect, it } from 'vitest';
import {
  addPoint, commit, excerptAt, hasStylusTouch, hitStroke, paragraphOf, redo, shouldDraw, startHistory,
  toPagePoint, undo, withoutStroke, withStroke, type ReviewState, type Stroke,
} from '../review-ink';
import { canReview, reviewErrorText } from '../review-copy';

// review-copy acceptance criteria 2-4, 6, 8.
const empty: ReviewState = { marks: { pages: [] }, notes: [] };
const line = (y: number): Stroke => ({ tool: 'pen', color: 'red', w: 0.0025, pts: [[0.1, y], [0.9, y]] });

describe('AC2: who draws (palm rejection)', () => {
  it('Pencil and mouse draw; a finger only with "Draw with finger", never after the Pencil', () => {
    expect(shouldDraw('pen', { fingerDraw: false, penSeen: false })).toBe(true);
    expect(shouldDraw('mouse', { fingerDraw: false, penSeen: false })).toBe(true);
    expect(shouldDraw('touch', { fingerDraw: false, penSeen: false })).toBe(false); // scrolls
    expect(shouldDraw('touch', { fingerDraw: true, penSeen: false })).toBe(true);
    expect(shouldDraw('touch', { fingerDraw: true, penSeen: true })).toBe(false); // resting palm
  });

  it('spots the Apple Pencil among touches (so only it is kept from scrolling)', () => {
    expect(hasStylusTouch([{ touchType: 'direct' }, { touchType: 'stylus' }])).toBe(true);
    expect(hasStylusTouch([{ touchType: 'direct' }])).toBe(false);
    expect(hasStylusTouch([{}])).toBe(false);
  });
});

describe('AC3: marks are page-relative and stay put at any size', () => {
  it('maps a tap to the page and clamps outside taps', () => {
    const r = { left: 100, top: 50, width: 400, height: 600 };
    expect(toPagePoint(300, 350, r)).toEqual([0.5, 0.5]);
    expect(toPagePoint(0, 9999, r)).toEqual([0, 1]);
  });

  it('skips sub-pixel jitter and caps a stroke at 2,000 points', () => {
    const pts: Array<[number, number]> = [[0.5, 0.5]];
    expect(addPoint(pts, [0.5001, 0.5], 800)).toBe(false);
    expect(addPoint(pts, [0.51, 0.5], 800)).toBe(true);
    const full = Array.from({ length: 2000 }, (_, i) => [i / 2000, 0] as [number, number]);
    expect(addPoint(full, [0.99, 0.99], 800)).toBe(false);
  });

  it('eraser removes the stroke under it (the top-most), at any screen width', () => {
    const strokes = [line(0.2), line(0.21), line(0.6)];
    for (const width of [400, 1200]) {
      expect(hitStroke(strokes, [0.5, 0.205], width, 1.414)).toBe(1);
      expect(hitStroke(strokes, [0.5, 0.6], width, 1.414)).toBe(2);
      expect(hitStroke(strokes, [0.5, 0.9], width, 1.414)).toBe(-1);
    }
  });

  it('undo / redo cover strokes and notes', () => {
    let h = startHistory(empty);
    h = commit(h, withStroke(h.present, 2, line(0.3)));
    expect(h.present.marks.pages).toHaveLength(3);
    h = commit(h, { ...h.present, notes: [{ id: 'n', page: 0, x: 0.9, y: 0.2, text: 'check', excerpt: '' }] });
    h = undo(h);
    expect(h.present.notes).toHaveLength(0);
    expect(h.present.marks.pages[2]!.strokes).toHaveLength(1);
    h = undo(h);
    expect(h.present.marks.pages).toHaveLength(0);
    h = redo(redo(h));
    expect(h.present.notes).toHaveLength(1);
    expect(withoutStroke(h.present, 2, 0).marks.pages[2]!.strokes).toHaveLength(0);
    expect(undo(startHistory(empty))).toEqual(startHistory(empty));
  });
});

describe('AC6: a note finds its line and paragraph for Redraft', () => {
  const items = [
    { str: 'The petitioner', x: 0.1, y: 0.3 }, { str: 'states that', x: 0.4, y: 0.301 },
    { str: 'Next line', x: 0.1, y: 0.34 },
  ];
  it('reads the printed line at the tap', () => {
    expect(excerptAt(items, 0.302)).toBe('The petitioner states that');
    expect(excerptAt(items, 0.6)).toBe('');
  });
  it('finds the paragraph, ignoring punctuation and case', () => {
    const paras = ['IN THE COURT', '1. The petitioner states that the cheque was dishonoured.', '2. Next.'];
    expect(paragraphOf(paras, '1. The Petitioner states that')).toBe(1);
    expect(paragraphOf(paras, 'nothing like it')).toBe(-1);
    expect(paragraphOf(paras, 'abc')).toBe(-1);
  });
});

describe('AC8: Review on case files', () => {
  it('offered on PDF / Word files with a file; an existing review opens instead', () => {
    expect(canReview({ hasFile: true, fileName: 'Petition.pdf' })).toBe(true);
    expect(canReview({ hasFile: true, fileName: 'old.DOC' })).toBe(true);
    expect(canReview({ hasFile: true, fileName: 'photo.jpg', fileMime: 'image/jpeg' })).toBe(false);
    expect(canReview({ hasFile: false, fileName: 'x.pdf' })).toBe(false);
    expect(canReview({ kind: 'draft', hasFile: true, fileName: 'x.pdf' })).toBe(false);
    expect(canReview({ hasFile: true, fileName: 'x.pdf', reviewId: 'r1' })).toBe(false);
  });
  it('words every refusal', () => {
    expect(reviewErrorText('not_author')).toContain('Only the advocate');
    expect(reviewErrorText('weird')).toContain('try again');
  });
});
