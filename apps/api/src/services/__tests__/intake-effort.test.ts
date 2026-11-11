// ai-cost-efficiency: intake tasks run at a lower effort; drafting and
// checkBrief keep the model default; the switch and old models send nothing.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dev, cliCalls, apiCalls, e } = vi.hoisted(() => ({
  dev: { on: true },
  cliCalls: [] as Array<{ effort?: string }>,
  apiCalls: [] as Array<Record<string, unknown>>,
  e: { INTAKE_EFFORT_TUNED: 'true', intakeModel: 'claude-sonnet-5-5' },
}));
vi.mock('../../lib/claude-code-dev', () => ({
  devViaClaudeCode: () => dev.on,
  claudeCodeComplete: vi.fn(async (o: { effort?: string }) => { cliCalls.push(o); return { text: '{}' }; }),
}));
vi.mock('../../lib/anthropic-client', async (orig) => {
  const m = await orig<typeof import('../../lib/anthropic-client')>();
  return {
    ...m,
    withKeys: async (fn: (c: unknown) => Promise<unknown>) => fn({
      messages: { create: async (req: Record<string, unknown>) => {
        apiCalls.push(req);
        return { content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
      } },
    }),
  };
});
vi.mock('../../env', async (orig) => {
  const m = await orig<typeof import('../../env')>();
  return { ...m, env: new Proxy(m.env, { get: (t, k) => (k in e ? e[k as keyof typeof e] : k === 'llmProvider' ? 'anthropic' : k === 'intakeProvider' ? '' : t[k as keyof typeof t]) }) };
});

import { intakeLlm, intakeEffort } from '../intake-llm.service';
import { priceFor } from '../../lib/ai-pricing';

const classify = () => intakeLlm.classifyDocType({ brief: 'A cheque bounced.', labels: ['Sale Deed'] });
const phrase = () => intakeLlm.phrase({ docLabel: 'Notice', issues: [{ field: 'f', code: 'missing', message: 'm', label: 'F' }] });
const check = () => intakeLlm.checkBrief({ brief: 'A cheque bounced.', labels: ['Sale Deed'] });

describe('intake effort (features/ai-cost-efficiency.md)', () => {
  beforeEach(() => { cliCalls.length = 0; apiCalls.length = 0; dev.on = true; e.INTAKE_EFFORT_TUNED = 'true'; e.intakeModel = 'claude-sonnet-5-5'; });

  it('classify and phrase run at low; extract keeps the default (failed the gate at medium)', () => {
    expect(intakeEffort('classify', 'claude-sonnet-5-5')).toBe('low');
    expect(intakeEffort('phrase', 'claude-sonnet-5-5')).toBe('low');
    expect(intakeEffort('extract', 'claude-sonnet-5-5')).toBeUndefined();
  });

  it('dev route passes the effort to the CLI', async () => {
    await classify(); await phrase();
    expect(cliCalls.map((c) => c.effort)).toEqual(['low', 'low']);
  });

  it('API route sends output_config.effort', async () => {
    dev.on = false;
    await classify();
    expect(apiCalls[0]).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'low' } });
  });

  it('checkBrief keeps the model default (no effort sent)', async () => {
    await check();
    dev.on = false;
    await check();
    expect(cliCalls[0]!.effort).toBeUndefined();
    expect(apiCalls[0]).not.toHaveProperty('output_config');
  });

  it('INTAKE_EFFORT_TUNED=false restores the old request exactly', async () => {
    e.INTAKE_EFFORT_TUNED = 'false';
    dev.on = false;
    await classify();
    expect(apiCalls[0]).not.toHaveProperty('output_config');
  });

  it('a pre-5 model never gets an effort (it would reject it)', () => {
    expect(intakeEffort('classify', 'claude-haiku-4-5')).toBeUndefined();
    expect(intakeEffort('classify', 'claude-sonnet-4-6')).toBeUndefined();
  });
});

describe('ai-pricing: gpt-5.5', () => {
  it('is priced at OpenAI list ($5 in / $30 out), not the Sonnet fallback', () => {
    expect(priceFor('gpt-5.5')).toEqual({ inputPerMTok: 5, outputPerMTok: 30 });
  });
});
