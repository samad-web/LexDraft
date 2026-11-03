import { describe, expect, it } from 'vitest';
import { detectSections, rangeFromSelection } from '../draft-sections';

const BAIL = [
  'IN THE COURT OF THE PRINCIPAL SESSIONS JUDGE, CHENNAI',
  'BRIEF FACTS',
  '1. The petitioner was arrested on 16.09.2024.',
  '2. The charge sheet has been filed.',
  'GROUNDS',
  'A. THE PETITIONER IS IN CUSTODY FOR 96 DAYS',
  '3. The investigation is complete and custody serves no purpose.',
  'PRAYER: It is prayed that the petitioner be enlarged on bail.',
  'Place: Chennai',
];

describe('detectSections', () => {
  it('matches the API: heading-only + inline sections, ended by the place line', () => {
    expect(detectSections(BAIL)).toEqual([
      { title: 'BRIEF FACTS', from: 2, to: 3 },
      { title: 'GROUNDS', from: 5, to: 6 },
      { title: 'PRAYER', from: 7, to: 7 },
    ]);
  });
});

describe('rangeFromSelection', () => {
  it('maps a multi-line selection to the paragraphs it spans', () => {
    const sel = 'charge sheet has been filed.\nGROUNDS\nA. THE PETITIONER IS IN CUSTODY';
    expect(rangeFromSelection(BAIL, sel)).toEqual({ from: 3, to: 5 });
  });

  it('maps a fragment inside one paragraph to that paragraph', () => {
    expect(rangeFromSelection(BAIL, 'custody serves no')).toEqual({ from: 6, to: 6 });
  });

  it('returns null for text that is not in the draft', () => {
    expect(rangeFromSelection(BAIL, 'Related law: Section 480 BNSS')).toBeNull();
  });
});
