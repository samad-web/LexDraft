import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntakeState } from '@lexdraft/types';

// AI credits (unit) - tests map to the acceptance criteria (AC#) in
// build-docs/features/ai-credits.md. Row locks, refunds and unlock against a
// real database are in credits.integration.test.ts.

const h = vi.hoisted(() => ({
  meter: { paid: 0, needed: 0, paidWords: Number.POSITIVE_INFINITY, lockedCredits: 0 },
  balance: 0,
  applyEdits: vi.fn(async (_docx: string, _paras: string[]): Promise<string | null> => 'CUT_DOCX'),
}));

vi.mock('../credit.service', async (orig) => {
  const real = await orig<typeof import('../credit.service')>();
  return {
    ...real,
    creditService: {
      ...real.creditService,
      meterDraft: vi.fn(async () => h.meter),
      balance: vi.fn(async () => ({ balance: h.balance, allowance: 0, usedThisCycle: 0, topup: 0, resetsAt: null, unlimited: false })),
    },
  };
});
vi.mock('../engine-client.service', () => ({ engineClient: { enabled: true, applyEdits: h.applyEdits } }));

import { contractReviewCredits, CREDIT_COSTS, draftCredits, reviseCredits } from '../../lib/credit-costs';
import { allowanceFor, cycleBounds } from '../credit.service';
import { assertNotLocked, cutBlocks, cutRecord, cutText, draftMeterService, lockNotice } from '../draft-meter.service';

afterEach(() => {
  h.meter = { paid: 0, needed: 0, paidWords: Number.POSITIVE_INFINITY, lockedCredits: 0 };
  h.applyEdits.mockClear();
});

const words = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ');

describe('credit costs (v4 draft table)', () => {
  it('drafting: 1 per 400 words, rounded up to ½, minimum 1', () => {
    expect(draftCredits(1)).toBe(1);
    expect(draftCredits(400)).toBe(1);
    expect(draftCredits(401)).toBe(1.5);
    expect(draftCredits(800)).toBe(2);
    expect(draftCredits(1000)).toBe(2.5);
  });
  it('update document: ½ per page rewritten, minimum ½', () => {
    expect(reviseCredits(10)).toBe(0.5);
    expect(reviseCredits(800)).toBe(2);
  });
  it('contract review: 6 up to 10 pages, then ½ per extra page', () => {
    expect(contractReviewCredits(4000)).toBe(6);
    expect(contractReviewCredits(4001)).toBe(6.5);
    expect(contractReviewCredits(8000)).toBe(11);
  });
  it('AC9 web cost table matches the API', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../../web/src/lib/credit-costs.ts'), 'utf8');
    const lit = src.slice(src.indexOf('{', src.indexOf('export const CREDIT_COSTS')), src.indexOf('} as const') + 1);
    expect(new Function(`return ${lit}`)()).toEqual(CREDIT_COSTS);
  });
});

describe('monthly allowance and cycle', () => {
  const base = { plan_tier: 'Solo' as const, plan_status: 'active', free_plan: false, selected_plan: 'vakalat', seats: 1, renews_at: null, trial_ends_at: null };
  it('per plan; Associates per advocate; Munshi seats get none', () => {
    expect(allowanceFor({ ...base, selected_plan: 'sanad' })).toBe(25);
    expect(allowanceFor(base)).toBe(75);
    expect(allowanceFor({ ...base, selected_plan: 'brief' })).toBe(200);
    expect(allowanceFor({ ...base, plan_tier: 'Practice', selected_plan: 'associates', seats: 3 })).toBe(225);
  });
  it('free launch 25 till 1 Jun 2027, then 0; unpaid v4 sign-up 0; lapsed plan 0', () => {
    const free = { ...base, free_plan: true, plan_status: 'trial', selected_plan: 'free' };
    expect(allowanceFor(free, new Date('2026-12-01'))).toBe(25);
    expect(allowanceFor(free, new Date('2027-06-02'))).toBe(0);
    expect(allowanceFor({ ...base, plan_status: 'trial', trial_ends_at: new Date(Date.now() + 60_000) })).toBe(0);
    expect(allowanceFor({ ...base, plan_status: 'cancelled' })).toBe(0);
  });
  it('a yearly plan still resets monthly, on the renewal day', () => {
    const renews = new Date('2027-08-15T00:00:00Z');
    const c = cycleBounds(renews, new Date('2026-11-20T00:00:00Z'));
    expect(c.start.toISOString()).toBe('2026-11-15T00:00:00.000Z');
    expect(c.end.toISOString()).toBe('2026-12-15T00:00:00.000Z');
    const cal = cycleBounds(null, new Date('2026-11-20T00:00:00Z'));
    expect(cal.start.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
});

describe('AC3 the cut: nothing past the paid words leaves the server', () => {
  it('cutBlocks keeps whole blocks within the budget', () => {
    const blocks = [{ text: words('a', 300) }, { text: words('b', 300) }, { text: words('c', 300) }];
    expect(cutBlocks(blocks, 650).cutAt).toBe(2);
    expect(cutBlocks(blocks, 10_000).cutAt).toBeNull();
  });
  it('cutText stops at a paragraph break; cutRecord in key order', () => {
    const text = `${words('a', 300)}\n\n${words('b', 300)}\n\n${words('c', 300)}`;
    const out = cutText(text, 650);
    expect(out.cut).toBe(true);
    expect(out.text).toContain('b299');
    expect(out.text).not.toContain('c0');
    expect(cutRecord({ x: words('a', 500), y: words('b', 500) }, 600).rec).toEqual({ x: words('a', 500) });
  });

  const state = (): IntakeState => ({
    matterId: 'm1', version: 1, docLabel: 'Plaint', status: 'generated', transcript: [], factSheet: [], questions: [],
    directEntryFields: [], refusal: null,
    draft: { blocks: [{ key: 'b0', text: words('a', 400) }, { key: 'b1', text: words('b', 400) }, { key: 'b2', text: words('c', 400) }],
      signals: { review_banner: '', unverified_marker: '' }, unfilledSlots: ['x'], docxBase64: 'FULL_DOCX' },
    companionDraft: { docLabel: 'Affidavit', blocks: [{ key: 'c0', text: words('d', 200) }], signals: { review_banner: '', unverified_marker: '' }, unfilledSlots: [], docxBase64: 'FULL_AFF' },
  });

  it('intake: 3-page draft, 1 page paid -> one block + a lock notice; the .docx is rebuilt cut; companion withheld', async () => {
    h.meter = { paid: 1, needed: 3.5, paidWords: 400, lockedCredits: 2.5 };
    const out = await draftMeterService.intake({ firmId: 'f', userId: 'u' }, state());
    expect(out.locked).toEqual({ draftKey: 'intake:m1:Plaint', lockedCredits: 2.5 });
    expect(out.draft!.blocks.map((b) => b.key)).toEqual(['b0', '__locked__']);
    expect(JSON.stringify(out)).not.toContain('b0 ');
    expect(JSON.stringify(out)).not.toMatch(/\bb1\b|\bc1\b|FULL_DOCX|FULL_AFF/);
    expect(out.draft!.docxBase64).toBe('CUT_DOCX');
    const paras = h.applyEdits.mock.calls[0]![1];
    expect(paras[0]).toBe(words('a', 400));
    expect(paras[1]).toMatch(/locked/);
    expect(paras[2]).toBe('');
    expect(out.companionDraft).toBeNull();
  });

  it('when the engine cannot rebuild the cut .docx, no .docx is sent at all', async () => {
    h.meter = { paid: 1, needed: 3.5, paidWords: 400, lockedCredits: 2.5 };
    h.applyEdits.mockResolvedValueOnce(null);
    const out = await draftMeterService.intake({ firmId: 'f', userId: 'u' }, state());
    expect(out.draft!.docxBase64).toBeNull();
  });

  it('fully paid -> the state goes out untouched', async () => {
    h.meter = { paid: 3.5, needed: 3.5, paidWords: Number.POSITIVE_INFINITY, lockedCredits: 0 };
    const s = state();
    expect(await draftMeterService.intake({ firmId: 'f', userId: 'u' }, s)).toBe(s);
  });

  it('a stream only sends what the balance covers, then reports the lock', async () => {
    h.balance = 1; // 400 words
    h.meter = { paid: 1, needed: 2, paidWords: 400, lockedCredits: 1 };
    const m = await draftMeterService.stream({ firmId: 'f', userId: 'u' });
    let sent = '';
    for (const chunk of [`${words('a', 300)} `, `${words('b', 300)} `, words('c', 200)]) sent += m.push(chunk);
    expect(sent.match(/\S+/g)!.length).toBe(400);
    expect(sent).not.toContain('c0');
    const events: string[] = [];
    await m.finish((e) => events.push(e));
    expect(events).toEqual(['locked']);
  });
});

describe('AC4 a locked draft cannot be saved, signed or filed', () => {
  it('the cut copy carries the lock notice, and anything carrying it is refused with 409 draft_locked', () => {
    expect(() => assertNotLocked(`para one

${lockNotice(3)}`)).toThrow(expect.objectContaining({ status: 409, code: 'draft_locked' }));
    expect(() => assertNotLocked('', `<p>${lockNotice(1)}</p>`)).toThrow();
    expect(() => assertNotLocked('a whole draft', null)).not.toThrow();
  });
  it('the draft-save routes and the eFiling upload check it', () => {
    const read = (f: string) => fs.readFileSync(path.resolve(__dirname, f), 'utf8');
    expect(read('../../routes/drafts.routes.ts').match(/assertNotLocked\(/g)).toHaveLength(2);
    expect(read('../efiling-portal-pleadings.service.ts')).toContain('assertNotLocked(read.text)');
  });
});

describe('AC1 every AI route charges credits', () => {
  // Each handler that spends model time must charge or gate on credits. A new
  // AI route without one fails here.
  const ROUTES = path.resolve(__dirname, '../../routes');
  const CHARGES = /creditService\.|draftMeterService\.|intakeSetup\(/;
  // Charged inside the service they call (see the service for the charge).
  const SERVICE_CHARGED: Record<string, string[]> = {
    'drafting.routes.ts': ["'/revise'", "'/extract-fields'"],
    'research.routes.ts': ["'/ask'"],
    'diary-assistant.routes.ts': ['*'],
    'title-reports.routes.ts': ['*'],
    // Included in the session's 3 credits (charged at POST /sessions).
    'mock-arguments.routes.ts': ["'/sessions/:id/turns/stream'", "'/sessions/:id/conclude'", "'/sessions/:id/review/rerun'"],
    // Local text extraction (OCR), no model call.
    'review.routes.ts': ["'/extract'"],
  };
  it('no handler behind the AI rate limit is left uncharged', () => {
    const missing: string[] = [];
    for (const file of fs.readdirSync(ROUTES).filter((f) => f.endsWith('.routes.ts'))) {
      const src = fs.readFileSync(path.join(ROUTES, file), 'utf8');
      const handlers = src.split(/\n(?=\w+Router\.(?:post|get|put|patch)\()/);
      for (const h of handlers.slice(1)) {
        const head = h.slice(0, h.indexOf('\n'));
        if (!/llmGenerationLimiter|documentAskLimiter/.test(h.slice(0, 400))) continue;
        const allowed = SERVICE_CHARGED[file] ?? [];
        const top = h.slice(0, 200);
        if (allowed.includes('*') || allowed.some((p) => top.includes(p))) continue;
        if (!CHARGES.test(h)) missing.push(`${file}: ${head}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
