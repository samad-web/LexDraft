import { describe, expect, it } from 'vitest';
import { postCheckAnswer, type ResearchSource } from '../research.service';

const SOURCES: ResearchSource[] = [
  { caseTitle: 'Vijay Singh @ Vijay Kr. Sharma v. The State of Bihar', neutralCitation: '2024 INSC 735', reportedCitations: ['[2024] 10 S.C.R. 108'] },
  { caseTitle: 'M.KALA v. THE SECRETARY TO THE GOVERNMENT', neutralCitation: null, reportedCitations: [] },
];

describe('postCheckAnswer', () => {
  it('keeps grounded sentences and reports which sources were used', () => {
    const r = postCheckAnswer(
      'Conviction cannot rest on motive alone [S1]. A detention order relying on a statutory-bail order is vitiated [S2].',
      SOURCES,
    );
    expect(r.removed).toEqual([]);
    expect(r.used).toEqual([0, 1]);
    expect(r.answer).toBe('Conviction cannot rest on motive alone [S1]. A detention order relying on a statutory-bail order is vitiated [S2].');
  });

  it('strips a sentence whose only marker does not exist', () => {
    const r = postCheckAnswer('Motive alone is not enough [S1]. Bail is the rule [S9].', SOURCES);
    expect(r.answer).toBe('Motive alone is not enough [S1].');
    expect(r.removed).toEqual(['[S9]']);
    expect(r.used).toEqual([0]);
  });

  it('trims a mixed marker to its valid sources', () => {
    const r = postCheckAnswer('Circumstantial chains must be complete [S1, S7].', SOURCES);
    expect(r.answer).toBe('Circumstantial chains must be complete [S1].');
    expect(r.removed).toEqual([]);
  });

  it('strips a citation that is not in the retrieved set, keeps one that is', () => {
    const r = postCheckAnswer(
      'The rule is settled in 2024 INSC 735 [S1]. It was also followed in (2021) 4 SCC 412. Detention fails [S2].',
      SOURCES,
    );
    expect(r.answer).toBe('The rule is settled in 2024 INSC 735 [S1]. Detention fails [S2].');
    expect(r.removed).toEqual(['(2021) 4 SCC 412']);
  });

  it('strips a case name that is not a retrieved judgment, keeps one that is', () => {
    const r = postCheckAnswer(
      'In Vijay Singh v. State of Bihar the Court acquitted the appellants [S1]. Mehta v. State of Karnataka holds otherwise.\n\nSee also Rekha v. State of Tamil Nadu.',
      SOURCES,
    );
    expect(r.answer).toBe('In Vijay Singh v. State of Bihar the Court acquitted the appellants [S1].');
    expect(r.removed).toEqual(['Mehta v. State of Karnataka', 'Rekha v. State of Tamil Nadu']);
  });

  it('leaves an answer with no citations alone', () => {
    const r = postCheckAnswer('The extracts do not address limitation for this suit.', SOURCES);
    expect(r).toEqual({ answer: 'The extracts do not address limitation for this suit.', used: [], removed: [] });
  });
});
