import { describe, expect, it } from 'vitest';
import { applyReviseEdits, findIntroduced } from '../draft-revise.service';

const DRAFT = [
  'IN THE COURT OF THE JUDICIAL MAGISTRATE, CHENNAI',
  'The Complainant issued a legal notice dated 12.03.2026 demanding Rs. 5,00,000.',
  'The Accused failed to pay within 15 days, an offence under Section 138 of the NI Act.',
  'PRAYER: It is prayed that this Court may take cognizance.',
];

describe('applyReviseEdits', () => {
  it('replaces in place and keeps the paragraph count', () => {
    const r = applyReviseEdits(DRAFT, [{ op: 'replace', index: 3, text: 'PRAYER: It is most humbly prayed that this Hon’ble Court may take cognizance and punish the Accused.' }]);
    expect(r.paragraphs).toHaveLength(DRAFT.length);
    expect(r.changed).toEqual([3]);
    expect(r.inserted).toBe(0);
    expect(r.paragraphs.slice(0, 3)).toEqual(DRAFT.slice(0, 3));
  });

  it('inserts at the top, after an index, and deletes', () => {
    const r = applyReviseEdits(DRAFT, [
      { op: 'insert_after', index: -1, text: 'TOP' },
      { op: 'insert_after', index: 1, text: 'AFTER-1' },
      { op: 'delete', index: 2 },
    ]);
    expect(r.paragraphs).toEqual(['TOP', DRAFT[0], DRAFT[1], 'AFTER-1', DRAFT[3]]);
    expect(r.changed).toEqual([2]);
    expect(r.inserted).toBe(2);
    expect(r.added).toEqual(['TOP', 'AFTER-1']);
    expect(r.diff).toEqual([{ index: 2, before: DRAFT[2], after: null }]);
  });

  it('drops out-of-range, empty and no-op edits, and flattens line breaks', () => {
    const r = applyReviseEdits(DRAFT, [
      { op: 'replace', index: 99, text: 'x' },
      { op: 'replace', index: 0, text: '   ' },
      { op: 'replace', index: 1, text: DRAFT[1]! },
      { op: 'replace', index: 2, text: 'line one\nline two' },
      { op: 'delete', index: -3 },
    ]);
    expect(r.paragraphs).toHaveLength(DRAFT.length);
    expect(r.changed).toEqual([2]);
    expect(r.paragraphs[2]).toBe('line one line two');
  });
});

describe('findIntroduced', () => {
  const original = DRAFT.join('\n');

  it('passes figures and sections already in the draft or the instruction', () => {
    const w = findIntroduced(original, 'add interest at 18% per annum', [
      'The Accused is liable for Rs. 5,00,000 with interest at 18% per annum under Section 138.',
    ]);
    expect(w).toEqual([]);
  });

  it('flags invented case law, sections, amounts and dates', () => {
    const w = findIntroduced(original, 'make the prayer firmer', [
      'As held in Dashrath Rupsingh Rathod v. State of Maharashtra (2014) 9 SCC 129, read with Section 141, the Accused owes Rs. 7,50,000 since 01.01.2026.',
    ]);
    const text = w.join(' | ');
    expect(text).toMatch(/case citation/);
    expect(text).toMatch(/case name/);
    expect(text).toMatch(/Section 141/);
    expect(text).toMatch(/7,50,000/);
    expect(text).toMatch(/01\.01\.2026/);
  });
});
