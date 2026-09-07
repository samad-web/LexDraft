import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../env';

// intake-compose calls the raw Anthropic/xAI HTTP APIs directly (mirrors
// intake-llm.service) — mock global fetch so no real network call happens and
// every response is scripted per test.
const fetchQueue: Array<{ status: number; body: unknown }> = [];
const fetchCalls: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  fetchQueue.length = 0;
  fetchCalls.length = 0;
  (env as { ANTHROPIC_API_KEY: string }).ANTHROPIC_API_KEY = 'test-key';
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    fetchCalls.push({ url, body: JSON.parse(init.body) });
    const next = fetchQueue.shift();
    if (!next) throw new Error('fetch queue empty — test under-scripted');
    return {
      ok: next.status < 400,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    } as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function anthropicReply(text: string) {
  return { status: 200, body: { content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 10 } } };
}

import { intakeCompose } from '../intake-compose.service';

describe('intake-compose — compose only argues GIVEN facts', () => {
  const ENGINE_BLOCKS = [
    { key: 'p1', text: '1. Under instructions from my client, ACME, I issue this notice.' },
    { key: 'p2', text: '2. You issued Cheque No. 000105 dated 2026-04-16 for Rs. 399088/-.' },
  ];
  const FACTS = { 'Payee name': 'ACME', 'Cheque number': '000105', 'Cheque amount': '399088' };

  it('sends the engine blocks + facts to the model, and returns the composed blocks on a passing verify', async () => {
    // 1st call = compose, 2nd call = verify.
    fetchQueue.push(anthropicReply('1. Under instructions from my client, ACME, I issue this notice.\n\n2. You issued Cheque No. 000105 dated 2026-04-16 for Rs. 399088/-, which remains unpaid.'));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));

    const result = await intakeCompose.compose({
      docLabel: 'Notice u/s 138 NI Act', engineBlocks: ENGINE_BLOCKS, facts: FACTS, provider: 'anthropic',
    });

    expect(result.composed).toBe(true);
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.blocks.map((b) => b.text).join(' ')).toContain('ACME');
    // The compose call's prompt contains the given facts and the engine skeleton.
    const composeCall = fetchCalls[0]!;
    const composeBody = JSON.stringify(composeCall.body);
    expect(composeBody).toContain('ACME');
    expect(composeBody).toContain('000105');
  });

  it('falls back to the ENGINE\'S PLAIN draft when VERIFY finds an unsupported claim', async () => {
    fetchQueue.push(anthropicReply('1. ACME. 2. The cheque was for Rs. 50,00,000/- drawn on a Swiss bank.')); // fabricated!
    fetchQueue.push(anthropicReply('{"pass": false, "unsupported_claims": ["Rs. 50,00,000/-", "Swiss bank"]}'));

    const result = await intakeCompose.compose({
      docLabel: 'Notice u/s 138 NI Act', engineBlocks: ENGINE_BLOCKS, facts: FACTS, provider: 'anthropic',
    });

    expect(result.composed).toBe(false);
    // Falls back to EXACTLY the engine's own blocks — the fabricated prose never
    // reaches the advocate.
    expect(result.blocks).toEqual(ENGINE_BLOCKS);
    expect(result.rejectedReason).toContain('Swiss bank');
  });

  it('falls back to the plain draft when the compose call itself fails', async () => {
    fetchQueue.push({ status: 500, body: { error: 'server error' } });
    // withRetry will retry; queue enough failures to exhaust retries quickly is
    // not needed here since compose() catches and returns null on any thrown error
    // after retry exhausts — but to keep the test fast we just let it fail once
    // and rely on the outer catch; if withRetry retries internally, queue more.
    for (let i = 0; i < 5; i += 1) fetchQueue.push({ status: 500, body: { error: 'server error' } });

    const result = await intakeCompose.compose({
      docLabel: 'Notice u/s 138 NI Act', engineBlocks: ENGINE_BLOCKS, facts: FACTS, provider: 'anthropic',
    });

    expect(result.composed).toBe(false);
    expect(result.blocks).toEqual(ENGINE_BLOCKS);
  }, 15000);

  it('falls back to the plain draft when verify cannot be parsed (fail-closed, never fail-open)', async () => {
    fetchQueue.push(anthropicReply('Some enriched prose.'));
    fetchQueue.push(anthropicReply('not valid json at all'));

    const result = await intakeCompose.compose({
      docLabel: 'Notice u/s 138 NI Act', engineBlocks: ENGINE_BLOCKS, facts: FACTS, provider: 'anthropic',
    });

    expect(result.composed).toBe(false);
    expect(result.blocks).toEqual(ENGINE_BLOCKS);
  });
});
