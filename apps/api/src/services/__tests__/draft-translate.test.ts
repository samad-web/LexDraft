import { beforeEach, describe, expect, it, vi } from 'vitest';

// regional-languages (build-docs/features/regional-languages.md): the finished
// English draft is translated line by line; figures, [placeholders] and table rows
// are checked (no AI); HC/SC drafts stay English; charged once per document.
const calls: string[][] = [];
let reply: (lines: string[]) => string[] = (lines) => lines.map((l) => `TA:${l}`);
vi.mock('../../lib/anthropic-client', () => ({
  claudeComplete: async ({ user }: { user: string }) => {
    const lines = JSON.parse(user) as string[];
    calls.push(lines);
    return { text: JSON.stringify(reply(lines)), tokensIn: 0, tokensOut: 0 };
  },
}));
const charges: string[] = [];
const amounts: number[] = [];
vi.mock('../credit.service', () => ({
  CreditsExhaustedError: class extends Error {},
  creditService: { charge: async (_c: unknown, _a: string, n: number, ref: string) => { charges.push(ref); amounts.push(n); return {}; } },
}));
const written: string[][] = [];
vi.mock('../engine-client.service', () => ({
  engineClient: { applyEdits: async (_d: string, lines: string[]) => { written.push(lines); return 'DOCX-TA'; } },
}));
vi.mock('../ai-usage.service', () => ({ aiUsageService: { recordAsync: () => {} } }));

import type { IntakeState } from '@lexdraft/types';
import { draftTranslateService, englishOnlyForum, keepsInvariants, translateLines } from '../draft-translate.service';
import { translateCredits } from '../../lib/credit-costs';

const ctx = { firmId: 'f1', userId: 'u1' };
const state = (lines: string[], matterId = 'm1'): IntakeState => ({
  matterId, docLabel: 'Written statement', status: 'generated',
  draft: { blocks: lines.map((text, i) => ({ key: `p${i}`, text })), signals: { review_banner: '', unverified_marker: '' }, unfilledSlots: [], docxBase64: 'DOCX-EN' },
} as unknown as IntakeState);

beforeEach(() => {
  calls.length = 0; charges.length = 0; amounts.length = 0; written.length = 0;
  reply = (lines) => lines.map((l) => `TA:${l}`);
});

describe('regional languages', () => {
  it('invariants: figures, [placeholders] and table cells must survive', () => {
    expect(keepsInvariants('Rs. 3,00,000/- paid on 05.01.2026 [place to be provided]', 'ரூ. 3,00,000/- 05.01.2026 அன்று [place to be provided]')).toBe(true);
    expect(keepsInvariants('Rs. 3,00,000/- paid', 'ரூ. 30,000/- செலுத்தப்பட்டது')).toBe(false); // amount changed
    expect(keepsInvariants('[name to be provided] appeared', '[பெயர்] ஆஜரானார்')).toBe(false); // placeholder translated
    expect(keepsInvariants('| 1 | Xerox |', '| 1 | நகல் |')).toBe(true);
    expect(keepsInvariants('| 1 | Xerox |', '| 1 நகல் |')).toBe(false); // row broken
  });

  it('High Court / Supreme Court documents stay English with a note (Art. 348)', async () => {
    expect(englishOnlyForum(['IN THE HIGH COURT OF JUDICATURE AT MADRAS', 'W.P. No. 1 of 2026'])).toBe(true);
    const out = await draftTranslateService.intake(ctx, state(['IN THE HIGH COURT OF JUDICATURE AT MADRAS', '1. The facts.']), 'TA');
    expect(out.draft!.blocks[1]!.text).toBe('1. The facts.');
    expect(out.draftNotes!.join(' ')).toMatch(/must be in English/);
    expect(calls).toEqual([]);
    expect(charges).toEqual([]);
  });

  it('a district-court draft is translated, written into the Word file, charged once', async () => {
    const lines = ['IN THE COURT OF THE DISTRICT MUNSIF, MELUR', '1. The plaintiff paid Rs. 50,000/- on 01.02.2026.', '[place to be provided]'];
    const out = await draftTranslateService.intake(ctx, state(lines), 'TA');
    expect(out.draft!.blocks.map((b) => b.text)).toEqual([`TA:${lines[0]}`, `TA:${lines[1]}`, lines[2]]); // bracket-only line untouched
    expect(out.draft!.docxBase64).toBe('DOCX-TA');
    expect(written[0]).toEqual(out.draft!.blocks.map((b) => b.text));
    await draftTranslateService.intake(ctx, state(lines), 'TA');
    expect(charges).toEqual(['translate:m1:Written statement:TA', 'translate:m1:Written statement:TA']); // same ref: one charge
    expect(calls).toHaveLength(1); // second render: all from cache, no model call
  });

  it('price: ½ credit per 400-word page, minimum ½ (user, 2026-11-16)', async () => {
    const page = Array.from({ length: 400 }, (_, i) => 'word' + i).join(' ');
    await draftTranslateService.intake(ctx, state(['IN THE COURT OF X', page, page, page], 'm-price'), 'TA'); // 3 pages + 5 words
    expect(amounts).toEqual([2]); // 3.01 pages x ½ = 1.51 -> rounded up to the half: 2
    expect(translateCredits(10)).toBe(0.5);
    expect(translateCredits(800)).toBe(1);
  });

  it('only changed lines are sent again (live edit)', async () => {
    await translateLines('k-live', ['1. First para.', '2. Second para.'], 'HI', ctx);
    calls.length = 0;
    await translateLines('k-live', ['1. First para.', '2. Second para, edited.'], 'HI', ctx);
    expect(calls).toEqual([['2. Second para, edited.']]);
  });

  it('a line whose figure changes is retried, then kept in English with a note', async () => {
    reply = (lines) => lines.map((l) => l.includes('50,000') ? l.replace('50,000', '5,000') : `TA:${l}`);
    const out = await draftTranslateService.intake(ctx, state(['IN THE COURT OF THE SUB JUDGE, MADURAI', '2. Rs. 50,000/- was lent.'], 'm2'), 'TA');
    expect(out.draft!.blocks[1]!.text).toBe('2. Rs. 50,000/- was lent.');
    expect(out.draftNotes!.join(' ')).toMatch(/1 line stayed in English/);
    expect(calls.filter((c) => c.includes('2. Rs. 50,000/- was lent.'))).toHaveLength(2); // one retry
  });

  it('English, or a draft not yet generated, is returned unchanged', async () => {
    const s = state(['IN THE COURT OF X', '1. Facts.']);
    expect(await draftTranslateService.intake(ctx, s, 'EN')).toBe(s);
    expect(await draftTranslateService.intake(ctx, { ...s, status: 'gathering' } as IntakeState, 'TA')).toEqual({ ...s, status: 'gathering' });
    expect(calls).toEqual([]);
  });
});
