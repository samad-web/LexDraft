import { beforeEach, describe, expect, it, vi } from 'vitest';

const { complete, assertCanGenerate } = vi.hoisted(() => ({ complete: vi.fn(), assertCanGenerate: vi.fn() }));
vi.mock('../../lib/llm-drafting', () => ({
  complete,
  parseJsonLoose: (t: string) => JSON.parse(t),
  providerModel: () => 'm',
  resolveProvider: () => 'anthropic',
}));
vi.mock('../ai-quota.service', () => ({ aiQuotaService: { assertCanGenerate } }));
vi.mock('../ai-usage.service', () => ({ aiUsageService: { recordAsync: vi.fn() } }));

import { draftReviseService } from '../draft-revise.service';

const CTX = { firmId: 'f', userId: 'u' };
const paragraphs = ['1. The cheque is dated 10.11.2026.', '2. Mr. Ravi received it.'];

describe('redraft: an exact edit costs no AI call', () => {
  beforeEach(() => { complete.mockReset(); assertCanGenerate.mockReset(); });

  it('applies "change X to Y" without the model or the quota', async () => {
    const r = await draftReviseService.revise({ docType: 'x', instruction: 'change 10.11.2026 to 15.11.2026', paragraphs }, CTX);
    expect(r.paragraphs[0]).toContain('15.11.2026');
    expect(r.diff).toHaveLength(1);
    expect(complete).not.toHaveBeenCalled();
    expect(assertCanGenerate).not.toHaveBeenCalled();
  });

  it('sends a real rewrite to the model', async () => {
    complete.mockResolvedValue({ text: '{"edits":[],"summary":"ok"}', tokensIn: 1, tokensOut: 1, cacheRead: 0, cacheWrite: 0 });
    await draftReviseService.revise({ docType: 'x', instruction: 'make the grounds stronger', paragraphs }, CTX);
    expect(complete).toHaveBeenCalledOnce();
  });

  it('never treats an AI-review fix as an exact edit', async () => {
    complete.mockResolvedValue({ text: '{"edits":[],"summary":"ok"}', tokensIn: 1, tokensOut: 1, cacheRead: 0, cacheWrite: 0 });
    await draftReviseService.revise({ docType: 'x', instruction: 'change 10.11.2026 to 15.11.2026', paragraphs, source: 'review' }, CTX);
    expect(complete).toHaveBeenCalledOnce();
  });
});
