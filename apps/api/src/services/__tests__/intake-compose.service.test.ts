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
      // The Anthropic SDK reads response headers; without them every call throws.
      headers: new Headers({ 'content-type': 'application/json' }),
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

import { intakeCompose, segmentBlocks } from '../intake-compose.service';

// A real engine bail render: banners, numbered body with "[to be drafted]" gaps,
// a numbered prayer, then the place line.
const BAIL = [
  'PETITION FOR REGULAR BAIL UNDER SECTION 483 BNSS',
  '[DRAFT — for advocate review; not to be filed until reviewed and signed off]',
  '1. The petitioner, Dinesh Kumar, aged 34, lorry driver, residing at 47, Kamaraj Nagar, Avadi, Chennai.',
  '2. Prosecution case in brief: [to be drafted]',
  '3. The offence is registered under BNS s.303(2), BNS s.317(2).',
  '4. The petitioner was taken into custody on 2024-09-16 and has, as on 2024-12-20, been in custody for 96 days.',
  '5. Investigation status: the charge sheet has been filed.',
  '6. GROUNDS: [to be drafted]',
  "7. It is prayed that this Hon'ble Court may be pleased to enlarge the petitioner on bail.",
  'Place: Chennai',
].map((text, i) => ({ key: `p${i}`, text }));
const BAIL_FACTS = { 'Accused name': 'Dinesh Kumar', 'Occupation': 'lorry driver', 'Arrest date': '2024-09-16' };

describe('intake-compose — body-only composition', () => {
  it('segments head / body / prayer / tail', () => {
    expect(segmentBlocks(BAIL)).toEqual({ start: 2, bodyEnd: 7, end: 8, startNumber: 1 });
  });

  it('keeps head, prayer and tail verbatim, renumbers the prayer, and returns the splice', async () => {
    fetchQueue.push(anthropicReply([
      '1. The petitioner, Dinesh Kumar, aged 34, is a lorry driver residing at 47, Kamaraj Nagar, Avadi, Chennai.',
      '2. The offence is registered under BNS s.303(2) and BNS s.317(2).',
      '3. The petitioner was taken into custody on 2024-09-16 and, as on 2024-12-20, has been in custody for 96 days.',
      '4. That the charge sheet has been filed, so the investigation is complete and custodial interrogation is no longer required.',
      '5. That the petitioner has a fixed residence and occupation, so there is no risk of flight.',
    ].join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));

    const r = await intakeCompose.compose({
      docLabel: 'Regular Bail Application', docType: 'regular_bail', engineBlocks: BAIL, facts: BAIL_FACTS, provider: 'anthropic',
    });

    expect(r.composed).toBe(true);
    const texts = r.blocks.map((b) => b.text);
    expect(texts.slice(0, 2)).toEqual([BAIL[0]!.text, BAIL[1]!.text]);
    expect(texts.at(-2)).toBe("6. It is prayed that this Hon'ble Court may be pleased to enlarge the petitioner on bail.");
    expect(texts.at(-1)).toBe('Place: Chennai');
    expect(r.splice).toEqual({ start: 2, end: 8, paragraphs: texts.slice(2, -1) });
    // The bail guide reached the model.
    expect(JSON.stringify(fetchCalls[0]!.body)).toContain('GROUNDS, numbered');
  });

  it('rejects a composition that drops a section from the skeleton', async () => {
    fetchQueue.push(anthropicReply('1. The petitioner, Dinesh Kumar, is a lorry driver.\n\n2. The offence is under BNS s.303(2).\n\n3. Arrested on 2024-09-16, in custody 96 days as on 2024-12-20.'));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const r = await intakeCompose.compose({
      docLabel: 'Regular Bail Application', docType: 'regular_bail', engineBlocks: BAIL, facts: BAIL_FACTS, provider: 'anthropic',
    });
    expect(r.composed).toBe(false);
    expect(r.blocks).toEqual(BAIL);
    expect(r.rejectedReason).toContain('317(2)');
  });

  it('strips an invented sentence instead of discarding the whole draft', async () => {
    fetchQueue.push(anthropicReply([
      '1. The petitioner, Dinesh Kumar, aged 34, is a lorry driver residing at 47, Kamaraj Nagar, Avadi, Chennai. He paid Rs. 50,000/- as compensation to the complainant.',
      '2. The offence is registered under BNS s.303(2) and BNS s.317(2).',
      '3. The petitioner was taken into custody on 2024-09-16 and, as on 2024-12-20, has been in custody for 96 days.',
    ].join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const r = await intakeCompose.compose({
      docLabel: 'Regular Bail Application', docType: 'regular_bail', engineBlocks: BAIL, facts: BAIL_FACTS, provider: 'anthropic',
    });
    expect(r.composed).toBe(true);
    expect(r.blocks.map((b) => b.text).join(' ')).not.toContain('50,000');
    expect(r.removedSentences).toEqual(['He paid Rs. 50,000/- as compensation to the complainant.']);
  });
});

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
