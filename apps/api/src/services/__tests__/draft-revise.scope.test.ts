import { beforeEach, describe, expect, it, vi } from 'vitest';

// Multi-paragraph redraft: section detection, enforced focus, and the review
// source not whitelisting figures. Scripted model replies; no network.
const replies: string[] = [];
const calls: Array<{ user: string; maxTokens: number }> = [];
vi.mock('../../lib/llm-drafting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/llm-drafting')>();
  return {
    ...actual,
    resolveProvider: () => 'anthropic' as const,
    providerModel: () => 'test-model',
    complete: vi.fn(async (_p: string, _s: string, user: string, maxTokens: number) => {
      calls.push({ user, maxTokens });
      const text = replies.shift();
      if (text === undefined) throw new Error('reply queue empty');
      return { text, tokensIn: 1, tokensOut: 1, cacheRead: 0, cacheWrite: 0 };
    }),
  };
});
vi.mock('../ai-quota.service', () => ({
  aiQuotaService: { assertCanGenerate: vi.fn(async () => ({})) },
  AiQuotaExceededError: class extends Error {},
}));
vi.mock('../ai-usage.service', () => ({ aiUsageService: { recordAsync: vi.fn() } }));

import { detectSections, draftReviseService, limitToFocus, sectionFromInstruction } from '../draft-revise.service';

const BAIL = [
  'IN THE COURT OF THE PRINCIPAL SESSIONS JUDGE, CHENNAI',          // 0
  'Crl.M.P. No. ____ of 2026',                                       // 1
  'BRIEF FACTS',                                                     // 2
  '1. The petitioner was arrested on 16.09.2024.',                   // 3
  '2. The charge sheet has been filed.',                             // 4
  'GROUNDS',                                                         // 5
  'A. THE PETITIONER IS IN CUSTODY FOR 96 DAYS',                     // 6
  '3. The investigation is complete and custody serves no purpose.', // 7
  '4. The petitioner has no antecedents.',                           // 8
  'PRAYER: It is prayed that the petitioner be enlarged on bail.',   // 9
  'Place: Chennai',                                                  // 10
  'Counsel for the Petitioner',                                      // 11
];
const CTX = { firmId: null, userId: 'u1' };

beforeEach(() => { replies.length = 0; calls.length = 0; });

describe('detectSections', () => {
  it('finds heading-only and inline sections, ending at the place/signature block', () => {
    expect(detectSections(BAIL)).toEqual([
      { title: 'BRIEF FACTS', from: 3, to: 4 },
      // the all-caps sub-heading inside the grounds does not end the section
      { title: 'GROUNDS', from: 6, to: 8 },
      { title: 'PRAYER', from: 9, to: 9 },
    ]);
  });

  it('maps an instruction to the one section it names', () => {
    expect(sectionFromInstruction('rewrite the grounds stronger', BAIL)).toEqual({ title: 'GROUNDS', from: 6, to: 8 });
    expect(sectionFromInstruction('make the prayer firmer', BAIL)?.title).toBe('PRAYER');
    expect(sectionFromInstruction('fix grammar', BAIL)).toBeNull();
    expect(sectionFromInstruction('align the facts with the prayer', BAIL)).toBeNull(); // two sections
  });
});

describe('limitToFocus', () => {
  it('keeps edits inside the range and inserts at its edges', () => {
    const kept = limitToFocus([
      { op: 'replace', index: 7, text: 'x' },
      { op: 'replace', index: 3, text: 'outside' },
      { op: 'insert_after', index: 5, text: 'before first' },
      { op: 'insert_after', index: 8, text: 'at end' },
      { op: 'insert_after', index: 9, text: 'after range' },
      { op: 'delete', index: 6 },
    ], { from: 6, to: 8 });
    expect(kept.map((e) => `${e.op}:${e.index}`)).toEqual(['replace:7', 'insert_after:5', 'insert_after:8', 'delete:6']);
  });
});

describe('draftReviseService.revise — scope', () => {
  it('auto-scopes "rewrite the grounds" and drops edits outside it', async () => {
    replies.push(JSON.stringify({
      edits: [
        { op: 'replace', index: 7, text: '3. The investigation is complete; further custody serves no purpose.' },
        { op: 'insert_after', index: 8, text: '5. The petitioner undertakes to abide by any condition.' },
        { op: 'replace', index: 3, text: '1. The petitioner was arrested illegally.' },
      ],
      summary: 'Grounds strengthened.', questions: [],
    }));
    const r = await draftReviseService.revise({ docType: 'Bail', instruction: 'rewrite the grounds stronger', paragraphs: BAIL }, CTX);
    expect(r.scope).toEqual({ from: 6, to: 8, label: 'GROUNDS' });
    expect(calls[0]!.user).toContain('SCOPE: only paragraphs [6]-[8] (the GROUNDS section)');
    expect(r.changed).toEqual([7]);
    expect(r.added).toEqual(['5. The petitioner undertakes to abide by any condition.']);
    expect(r.paragraphs[3]).toBe(BAIL[3]);
  });

  it('clamps a client range, labels it when it is a section, and sizes tokens to it', async () => {
    replies.push(JSON.stringify({ edits: [], summary: 'none', questions: [] }));
    const r = await draftReviseService.revise(
      { docType: 'Bail', instruction: 'tighten this', paragraphs: BAIL, focus: { from: 2, to: 50 } }, CTX,
    );
    expect(r.scope).toEqual({ from: 2, to: 11, label: null });
    expect(calls[0]!.maxTokens).toBe(8000);

    replies.push(JSON.stringify({ edits: [], summary: 'none', questions: [] }));
    const s = await draftReviseService.revise(
      { docType: 'Bail', instruction: 'tighten this', paragraphs: BAIL, focus: { from: 3, to: 4 } }, CTX,
    );
    expect(s.scope).toEqual({ from: 3, to: 4, label: 'BRIEF FACTS' });
    expect(calls[1]!.maxTokens).toBe(4000);
  });

  it('a review-sourced instruction does not whitelist its own figures', async () => {
    const edit = { op: 'replace', index: 3, text: '1. The petitioner was arrested on 16.09.2024 and produced on 18.09.2024.' };
    const instruction = 'In [3] add that he was produced before the Magistrate on 18.09.2024.';
    replies.push(JSON.stringify({ edits: [edit], summary: 's', questions: [] }));
    const advocate = await draftReviseService.revise({ docType: 'Bail', instruction, paragraphs: BAIL }, CTX);
    expect(advocate.warnings).toEqual([]);

    replies.push(JSON.stringify({ edits: [edit], summary: 's', questions: [] }));
    const review = await draftReviseService.revise({ docType: 'Bail', instruction, paragraphs: BAIL, source: 'review' }, CTX);
    expect(review.warnings.join(' ')).toMatch(/18\.09\.2024/);
  });
});
