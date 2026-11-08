import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// review-provider: Contract Review on OpenAI via REVIEW_PROVIDER, never a silent switch.
// In-memory mode (no DB); both model clients are fakes that record who was called.
const calls: string[] = [];
const usage: Array<{ provider?: string | null; model?: string | null }> = [];
const REPLY = JSON.stringify({ riskScore: 70, summary: 'ok', findings: [
  { severity: 'High', title: 'One-sided termination', excerpt: 'may terminate', law: 'ICA s.23', suggestion: 'mutual' },
] });

vi.mock('../../db/client', () => ({ db: () => null }));
vi.mock('../../lib/anthropic-client', () => ({
  claudeComplete: async () => { calls.push('claude'); return { text: REPLY, tokensIn: 1, tokensOut: 1 }; },
}));
vi.mock('../../lib/grok-client', () => ({
  grokComplete: async () => { calls.push('openai-compat'); return { text: REPLY, tokensIn: 1, tokensOut: 1 }; },
}));
vi.mock('../ai-usage.service', () => ({
  aiUsageService: { recordAsync: (u: { provider?: string | null; model?: string | null }) => { usage.push(u); } },
}));

import { env } from '../../env';
import { reviewService } from '../review.service';

const e = env as unknown as Record<string, unknown>;
const saved = { ...e };
const CONTRACT = 'The Company may terminate this Agreement at any time without cause. '.repeat(3);
const run = () => reviewService.create({
  firmId: '11111111-1111-1111-1111-111111111111', createdBy: null, perspective: 'Vendor', sourceText: CONTRACT,
});

beforeEach(() => {
  calls.length = 0;
  usage.length = 0;
  Object.assign(e, { ANTHROPIC_API_KEY: 'anthropic-test', llmProvider: 'anthropic' });
});
afterEach(() => { Object.assign(e, saved); });

describe('Contract Review provider', () => {
  it('default: stays on Claude', async () => {
    Object.assign(e, { REVIEW_PROVIDER: 'default' });
    const r = await run();
    expect(r.status).toBe('completed');
    expect(calls).toEqual(['claude']);
  });

  it('REVIEW_PROVIDER=openai with a key: OpenAI only, logged as openai', async () => {
    Object.assign(e, {
      REVIEW_PROVIDER: 'openai', OPENAI_API_KEY: 'openai-test', XAI_MODEL: 'gpt-5.5',
      openaiCompat: { vendor: 'openai', baseURL: 'https://api.openai.com/v1' },
    });
    const r = await run();
    expect(r.status).toBe('completed');
    expect(calls).toEqual(['openai-compat']);
    expect(usage[0]).toMatchObject({ provider: 'openai', model: 'gpt-5.5' });
  });

  it('REVIEW_PROVIDER=openai without a key: fails, calls no model (not Claude, not xAI)', async () => {
    Object.assign(e, { REVIEW_PROVIDER: 'openai', OPENAI_API_KEY: '', XAI_API_KEY: 'xai-test' });
    const r = await run();
    expect(r.status).toBe('failed');
    expect(r.errorMessage).toContain('OPENAI_API_KEY');
    expect(calls).toEqual([]);
  });

  it('REVIEW_PROVIDER=openai overrides a request asking for Anthropic', async () => {
    Object.assign(e, {
      REVIEW_PROVIDER: 'openai', OPENAI_API_KEY: 'openai-test',
      openaiCompat: { vendor: 'openai', baseURL: 'https://api.openai.com/v1' },
    });
    await reviewService.create({
      firmId: '11111111-1111-1111-1111-111111111111', createdBy: null, perspective: 'Client',
      sourceText: CONTRACT, provider: 'anthropic',
    });
    expect(calls).toEqual(['openai-compat']);
  });
});
