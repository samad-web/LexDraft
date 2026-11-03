import { beforeEach, describe, expect, it, vi } from 'vitest';

// Scripted model replies; no network. Same mocking pattern as drafting-orchestrator.
const replies: string[] = [];
const calls: Array<{ system: string; user: string }> = [];
vi.mock('../../lib/llm-drafting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/llm-drafting')>();
  return {
    ...actual,
    resolveProvider: () => 'anthropic' as const,
    providerModel: () => 'test-model',
    complete: vi.fn(async (_p: string, system: string, user: string) => {
      calls.push({ system, user });
      const text = replies.shift();
      if (text === undefined) throw new Error('reply queue empty');
      return { text, tokensIn: 10, tokensOut: 10, cacheRead: 0, cacheWrite: 0 };
    }),
  };
});
const assertCanGenerate = vi.fn(async () => ({}));
vi.mock('../ai-quota.service', () => ({
  aiQuotaService: { assertCanGenerate: (...a: unknown[]) => assertCanGenerate(...(a as [])) },
  AiQuotaExceededError: class extends Error {},
}));
const recordAsync = vi.fn();
vi.mock('../ai-usage.service', () => ({ aiUsageService: { recordAsync: (...a: unknown[]) => recordAsync(...a) } }));

import { draftReviewService, numberingFindings, sanitizeFindings } from '../draft-review.service';

const DRAFT = [
  'IN THE COURT OF THE JUDICIAL MAGISTRATE, EGMORE',
  '1. The Complainant is the payee of Cheque No. 456789 dated 10.03.2026 for Rs. 5,00,000/-.',
  '2. The cheque was dishonoured on 15.03.2026 for "funds insufficient".',
  '3. The Complainant issued a legal notice dated 01.04.2026.',
  '5. The Accused failed to pay within 15 days.',
  'PRAYER',
  "1. It is prayed that this Hon'ble Court may take cognizance under Section 138 of the NI Act.",
];
const CTX = { firmId: 'firm-1', userId: 'user-1' };

beforeEach(() => {
  replies.length = 0;
  calls.length = 0;
  assertCanGenerate.mockClear();
  recordAsync.mockClear();
});

describe('sanitizeFindings', () => {
  it('keeps valid findings and normalises bad enums and indices', () => {
    const out = sanitizeFindings([
      { severity: 'mandatory', category: 'limitation', paragraph: 3, issue: 'No averment that the notice was sent within 30 days.', fix: 'Add to [3] that the notice was sent within 30 days of the dishonour memo.', needs: [] },
      { severity: 'critical', category: 'nonsense', paragraph: 99, issue: '  Prayer   lacks costs. ', fix: null },
      { severity: 'minor', issue: '' },
      'junk',
    ], DRAFT);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ severity: 'mandatory', category: 'limitation', paragraph: 3, needs: [], warnings: [] });
    expect(out[0]!.excerpt).toBe(DRAFT[3]);
    expect(out[1]).toMatchObject({ severity: 'important', category: 'other', paragraph: null, excerpt: null, issue: 'Prayer lacks costs.', fix: null });
  });

  it('turns an inline "needs:" fix into a need, not a fix', () => {
    const [f] = sanitizeFindings([{ severity: 'mandatory', paragraph: null, issue: 'Date of the complaint is not averred.', fix: 'needs: date the complaint is presented' }], DRAFT);
    expect(f!.fix).toBeNull();
    expect(f!.needs).toEqual(['date the complaint is presented']);
  });

  it('drops a fix that invents a date or amount and asks for the fact instead', () => {
    const [f] = sanitizeFindings([{
      severity: 'mandatory', paragraph: 4, issue: 'Lapse of 15 days not dated.',
      fix: 'State in [4] that the notice was received on 05.04.2026 and 15 days lapsed on 20.04.2026.',
    }], DRAFT);
    expect(f!.fix).toBeNull();
    expect(f!.needs.join(' ')).toMatch(/date to use/);
    expect(f!.needs.join(' ')).toMatch(/05\.04\.2026/);
  });

  it('keeps a fix with only draft figures, and warns on a new section', () => {
    const [ok, law] = sanitizeFindings([
      { severity: 'important', paragraph: 1, issue: 'Amount should be in words.', fix: 'In [1] write Rs. 5,00,000/- also in words. Use ____ for the bank name.' },
      { severity: 'important', paragraph: 6, issue: 'Prayer omits compensation.', fix: 'Add a prayer for compensation under Section 357 of the BNSS.' },
    ], DRAFT);
    expect(ok!.fix).toMatch(/5,00,000/);
    expect(ok!.warnings).toEqual([]);
    expect(law!.fix).toMatch(/Section 357/);
    expect(law!.warnings.join(' ')).toMatch(/section "Section 357"/);
  });
});

describe('numberingFindings', () => {
  it('flags a jump and a repeat, not a restart at 1', () => {
    const f = numberingFindings(DRAFT);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: 'minor', category: 'format', paragraph: 4 });
    expect(f[0]!.issue).toMatch(/jumps from 3 to 5/);

    const rep = numberingFindings(['1. a b', '2. c d', '2. e f']);
    expect(rep[0]!.issue).toMatch(/used twice/);
  });
});

describe('draftReviewService.review', () => {
  it('checks quota, records usage, merges code findings and orders by severity', async () => {
    replies.push(JSON.stringify({
      summary: 'Fit to file after two fixes.',
      findings: [
        { severity: 'minor', category: 'format', paragraph: 0, issue: 'Cause title lacks the case number line.', fix: 'Add "C.C. No. ____ of 2026" below [0].' },
        { severity: 'mandatory', category: 'limitation', paragraph: 3, issue: 'No averment the notice was within 30 days.', fix: 'Add to [3] that the notice was within 30 days of the memo.' },
        { severity: 'minor', category: 'format', paragraph: 4, issue: 'Numbering skips 4.', fix: 'Renumber.' },
      ],
    }));
    const r = await draftReviewService.review({ docType: 'Complaint u/s 138 NI Act', paragraphs: DRAFT }, CTX);
    expect(assertCanGenerate).toHaveBeenCalledWith('firm-1', 'user-1');
    expect(recordAsync).toHaveBeenCalledWith(expect.objectContaining({ feature: 'drafting', model: 'test-model' }));
    expect(calls[0]!.user).toContain('[3] 3. The Complainant issued a legal notice');
    expect(r.summary).toBe('Fit to file after two fixes.');
    expect(r.findings.map((f) => f.severity)).toEqual(['mandatory', 'minor', 'minor']);
    expect(r.findings.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    // The model's numbering finding is replaced by the code's.
    expect(r.findings.filter((f) => /numbering/i.test(f.issue))).toHaveLength(1);
    expect(r.findings.some((f) => /Numbering skips/.test(f.issue))).toBe(false);
    expect(r.findings.some((f) => /jumps from 3 to 5/.test(f.issue))).toBe(true);
  });

  it('returns the code findings and a notice when the reply is unreadable', async () => {
    replies.push('sorry, I cannot');
    const r = await draftReviewService.review({ docType: 'Complaint', paragraphs: DRAFT }, CTX);
    expect(r.summary).toMatch(/could not be read/);
    expect(r.findings).toHaveLength(1);
  });
});

describe('salvageReview — a reply cut off mid-findings', () => {
  it('keeps the complete findings and drops the half-written one', async () => {
    const { salvageReview } = await import('../draft-review.service');
    const cut = '{"summary":"Two issues.","findings":[{"severity":"important","issue":"A"},{"severity":"minor","issue":"B"},{"severity":"minor","iss';
    const r = salvageReview(cut) as { summary: string; findings: Array<{ issue: string }> };
    expect(r.summary).toBe('Two issues.');
    expect(r.findings.map((f) => f.issue)).toEqual(['A', 'B']);
    expect(salvageReview('not json')).toBeNull();
  });
});
