// review-copy: the pure parts (caps, rotation, flatten). DB paths are covered by the
// local end-to-end run (build-docs/TESTING.md). LibreOffice is mocked here.
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { cleanMarks, cleanNotes, flatten, notesHtml, toUserSpace } from '../reviews.service';
import { convertToPdf } from '../document-render.service';

vi.mock('../document-render.service', () => ({ convertToPdf: vi.fn() }));
vi.mock('../../db/client', () => ({ db: () => null }));

async function pdf(pages: number, rotate = 0): Promise<Buffer> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([595, 842]).setRotation(degrees(rotate));
  return Buffer.from(await d.save());
}

describe('cleanMarks / cleanNotes (stored shape + caps)', () => {
  it('keeps good strokes, clamps points to the page, drops bad ones and pages past the end', () => {
    const m = cleanMarks({ pages: [
      { strokes: [
        { tool: 'pen', color: 'red', w: 0.003, pts: [[0.1, 0.2], [1.4, -2]] },
        { tool: 'laser', color: 'red', w: 0.003, pts: [[0, 0]] },
        { tool: 'hl', color: 'green', w: 0.01, pts: [[0, 0]] },
        { tool: 'hl', color: 'yellow', w: 9, pts: [[0.5, 0.5]] },
      ] },
      { strokes: [] },
      { strokes: [{ tool: 'pen', color: 'black', w: 0.002, pts: [[0.1, 0.1]] }] },
    ] }, 2);
    expect(m.pages).toHaveLength(2);
    expect(m.pages[0]!.strokes).toEqual([
      { tool: 'pen', color: 'red', w: 0.003, pts: [[0.1, 0.2], [1, 0]] },
      { tool: 'hl', color: 'yellow', w: 0.05, pts: [[0.5, 0.5]] },
    ]);
    expect(cleanMarks(null, 3)).toEqual({ pages: [] });
  });

  it('refuses more than 5,000 strokes or a 2,001-point stroke', () => {
    const s = { tool: 'pen', color: 'black', w: 0.002, pts: [[0, 0]] };
    expect(() => cleanMarks({ pages: [{ strokes: Array(5001).fill(s) }] }, 1)).toThrow('too_many_marks');
    expect(() => cleanMarks({ pages: [{ strokes: [{ ...s, pts: Array(2001).fill([0, 0]) }] }] }, 1)).toThrow('stroke_too_long');
  });

  it('notes: valid pages only, 2,000 characters and 200 notes at most', () => {
    const n = cleanNotes([
      { id: 'a', page: 0, x: 0.9, y: 0.3, text: 'check date', excerpt: '1. The petitioner' },
      { id: 'b', page: 5, x: 0, y: 0, text: 'past the end' },
      { id: 'c', page: 0, x: 2, y: -1, text: 'clamped' },
    ], 2);
    expect(n.map((x) => [x.id, x.x, x.y])).toEqual([['a', 0.9, 0.3], ['c', 1, 0]]);
    expect(() => cleanNotes([{ page: 0, text: 'x'.repeat(2001) }], 1)).toThrow('note_too_long');
    expect(() => cleanNotes(Array(201).fill({ page: 0, text: 'x' }), 1)).toThrow('too_many_notes');
  });
});

describe('toUserSpace (marks land where they were drawn, rotated pages too)', () => {
  it.each([
    [0, [0.25 * 595, 0.1 * 842]],
    [90, [0.1 * 595, 842 - 0.25 * 842]],
    [180, [595 - 0.25 * 595, 842 - 0.1 * 842]],
    [270, [595 - 0.1 * 595, 0.25 * 842]],
  ])('rotate %i', (rot, expected) => {
    const [x, y] = toUserSpace(0.25, 0.1, 595, 842, rot as number);
    expect(x).toBeCloseTo(expected[0]!, 5);
    expect(y).toBeCloseTo(expected[1]!, 5);
  });
});

describe('flatten (Save to Documents)', () => {
  const marks = { pages: [{ strokes: [
    { tool: 'pen' as const, color: 'red' as const, w: 0.003, pts: [[0.1, 0.1], [0.5, 0.1]] as Array<[number, number]> },
    { tool: 'hl' as const, color: 'yellow' as const, w: 0.02, pts: [[0.1, 0.3], [0.9, 0.3]] as Array<[number, number]> },
  ] }] };
  const notes = [{ id: 'n1', page: 1, x: 0.95, y: 0.4, text: 'வாதி பெயர் சரிபார்க்கவும்', excerpt: '' }];

  it('AC5: draws the marks and pins, and appends the notes page', async () => {
    vi.mocked(convertToPdf).mockResolvedValue(await pdf(1));
    const src = await pdf(2);
    const out = await flatten(src, marks, notes, 'Ravi petition');
    expect(out.notesPage).toBe(true);
    const doc = await PDFDocument.load(out.pdf);
    expect(doc.getPageCount()).toBe(3);
    expect(out.pdf.length).toBeGreaterThan(src.length);
    // the notes page is made from HTML in UTF-8 (Noto fonts in LibreOffice), Tamil kept
    const html = vi.mocked(convertToPdf).mock.calls[0]![0].toString('utf8');
    expect(vi.mocked(convertToPdf).mock.calls[0]![1]).toBe('html');
    expect(html).toContain('வாதி பெயர் சரிபார்க்கவும்');
    expect(html).toContain('Page 2');
  });

  it('LibreOffice down: the marked pages are still saved, notesPage false', async () => {
    vi.mocked(convertToPdf).mockRejectedValueOnce(new Error('soffice'));
    const out = await flatten(await pdf(2), marks, notes, 'x');
    expect(out.notesPage).toBe(false);
    expect((await PDFDocument.load(out.pdf)).getPageCount()).toBe(2);
  });

  it('a rotated scan flattens without error', async () => {
    const out = await flatten(await pdf(1, 90), marks, [], 'scan');
    expect(out.notesPage).toBe(true);
    expect((await PDFDocument.load(out.pdf)).getPageCount()).toBe(1);
  });

  it('notesHtml escapes the advocate\'s text', () => {
    expect(notesHtml('<b>', [{ id: 'a', page: 0, x: 0, y: 0, text: '<script>x</script>', excerpt: '' }]))
      .not.toContain('<script>');
  });
});
