import { describe, expect, it } from 'vitest';
import { claudeOnly, env } from '../env';

// build-docs/features/claude-only.md: no client facts go to another AI vendor.
const prodLike = () => ({
  XAI_API_KEY: 'xai-key', OPENAI_API_KEY: 'sk-openai', LLM_PROVIDER: 'xai',
  INTAKE_PROVIDER: 'xai', REVIEW_PROVIDER: 'openai', LLM_FAILOVER: 'true',
});

describe('claude only', () => {
  it('AC1: drops the xAI/OpenAI keys and sends every provider setting to Claude', () => {
    const d = prodLike();
    const ignored = claudeOnly(d);
    expect(d).toEqual({
      XAI_API_KEY: '', OPENAI_API_KEY: '', LLM_PROVIDER: 'anthropic',
      INTAKE_PROVIDER: 'anthropic', REVIEW_PROVIDER: 'default', LLM_FAILOVER: 'false',
    });
    expect(ignored.sort()).toEqual(Object.keys(prodLike()).sort());
  });

  it('AC2: leaves a Claude-only config untouched (only failover is switched off)', () => {
    const d = { XAI_API_KEY: '', OPENAI_API_KEY: '', LLM_PROVIDER: 'auto', INTAKE_PROVIDER: '', REVIEW_PROVIDER: 'default', LLM_FAILOVER: 'false' };
    expect(claudeOnly(d)).toEqual([]);
    expect(d.LLM_PROVIDER).toBe('auto');
  });

  it('AC3: the running env never resolves to the xAI/OpenAI slot', () => {
    expect(env.XAI_API_KEY).toBe('');
    expect(env.llmProvider).not.toBe('xai');
    expect(env.REVIEW_PROVIDER).toBe('default');
    expect(env.LLM_FAILOVER).toBe('false');
  });

  it('AC4: the OpenAI-compatible client refuses to start without a key', async () => {
    const { grok } = await import('../lib/grok-client');
    expect(() => grok()).toThrow(/Claude only/);
  });
});
