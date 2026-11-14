import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Diary briefing narrative costs ½ credit (owner, 2026-11-14): charged once per
// day + range + entries, reused on re-open; out of credits -> counts only.

const h = vi.hoisted(() => ({
  charges: [] as string[],
  out: false,
  calls: 0,
  failModel: false,
}));

vi.mock('../../env', async (orig) => {
  const real = await orig<typeof import('../../env')>();
  return { env: { ...real.env, llmProvider: 'anthropic' } };
});
vi.mock('../../lib/anthropic-client', () => ({
  claudeComplete: vi.fn(async () => {
    h.calls++;
    if (h.failModel) throw new Error('model down');
    return { text: 'Two hearings today.', tokensIn: 1, tokensOut: 1, cacheRead: 0, cacheWrite: 0 };
  }),
}));
vi.mock('../diary.service', () => ({ diaryService: { list: async () => [] } }));
vi.mock('../limitations.service', () => ({ limitationsService: { list: async () => [] } }));
vi.mock('../hearings.service', () => ({
  hearingsService: {
    listForDay: async (_f: string, d: string) => [{ date: d, time: '10:30', case: `OS ${h.calls}/2026`, court: 'City Civil Court', purpose: 'Hearing' }],
  },
}));
vi.mock('../credit.service', async (orig) => {
  const real = await orig<typeof import('../credit.service')>();
  const refunds: string[] = [];
  return {
    ...real,
    creditService: {
      charge: vi.fn(async (_ctx: unknown, _a: string, credits: number, refKey: string) => {
        if (h.out) throw new real.CreditsExhaustedError({ balance: 0, needed: credits, resetsAt: null });
        h.charges.push(`${refKey}|${credits}`);
        return { refKey, credits, refund: async () => { refunds.push(refKey); h.charges = h.charges.filter((c) => !c.startsWith(refKey)); } };
      }),
    },
  };
});

let diaryAssistantService: typeof import('../diary-assistant.service')['diaryAssistantService'];
beforeAll(async () => {
  ({ diaryAssistantService } = await import('../diary-assistant.service'));
});

afterEach(() => {
  h.charges = [];
  h.out = false;
  h.failModel = false;
});

describe('diary briefing narrative credits', () => {
  it('½ credit for a new briefing; opening the diary again the same day is free (no second model call)', async () => {
    h.calls = 0;
    const a = await diaryAssistantService.briefing('f1', 'today', 'u1');
    expect(a.narrative).toBe('Two hearings today.');
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]).toMatch(/^diary-briefing:u1:today:\d{4}-\d{2}-\d{2}:[0-9a-f]{16}\|0\.5$/);
    const calls = h.calls;
    // Same entries (the stub's case number only changes when the model runs).
    h.calls = 0;
    const first = await diaryAssistantService.briefing('f1', 'today', 'u2');
    h.charges = [];
    h.calls = 0;
    const again = await diaryAssistantService.briefing('f1', 'today', 'u2');
    expect(again.narrative).toBe(first.narrative);
    expect(h.charges).toHaveLength(0);
    expect(h.calls).toBe(0);
    expect(calls).toBe(1);
  });

  it('out of credits: counts only, no model call', async () => {
    h.out = true;
    h.calls = 0;
    const b = await diaryAssistantService.briefing('f1', 'week', 'u3');
    expect(b.narrative).toBe('');
    expect(b.modelUsed).toBe('fallback:quota');
    expect(h.calls).toBe(0);
    expect(b.counts.hearings).toBeGreaterThan(0);
  });

  it('a failed model call is refunded', async () => {
    h.failModel = true;
    const b = await diaryAssistantService.briefing('f1', 'week', 'u4');
    expect(b.narrative).toBe('');
    expect(h.charges).toHaveLength(0);
  });
});
