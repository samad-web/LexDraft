import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../env';

// anthropic-client reads its key pool once at import, before beforeEach runs;
// without this the suite only passed on machines with a real key in .env.
vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY ||= 'test-key';
});

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

import { intakeCompose, numberBody, segmentBlocks, replyDrift, composeNoticeFor, settleGaps, restoreDatedGaps, anchorOpening, guideFor } from '../intake-compose.service';
import { sentencesOf } from '../../lib/draft-guards';

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

  it('takes the WHOLE s.138 complaint body, un-numbered description lines included', () => {
    // Only taking "1. Description of the Complainant" left the skeleton body
    // printed again after the composed one.
    const complaint = [
      'IN THE COURT OF THE JUDICIAL MAGISTRATE, EGMORE',
      'COMPLAINT FILED UNDER SECTION 223 BNSS FOR THE OFFENCE UNDER SECTION 138 NI ACT',
      '1. Description of the Complainant',
      'Abdul Rahman, having his office at No. 15, Anna Nagar, Chennai.',
      '2. Description of the Accused',
      'Mohammed Irfan, residing at No. 24, Perambur, Chennai.',
      'The above-named Complainant humbly submits as follows:',
      '3. The Complainant is the payee of the cheque.',
      '(1) Cheque No. 456789 dated 10.03.2026 for Rs. 5,00,000/-.',
      '15. The Complainant seeks leave to file an additional list of witnesses.',
      'PRAYER',
      "It is, therefore, humbly prayed that this Hon'ble Court may be pleased to summon the Accused.",
      'Place: Chennai',
      'LIST OF DOCUMENTS FILED BY THE COMPLAINANT',
      '1. Dated 10.03.2026 — Cheque',
    ].map((text, i) => ({ key: `c${i}`, text }));
    expect(segmentBlocks(complaint)).toEqual({ start: 2, bodyEnd: 9, end: 9, startNumber: 1 });
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

  it('writ_petition: recounts BOTH the verification and the affidavit "paras 1 to N" (r10: verification kept 12)', async () => {
    const blocks = [...BAIL,
      'Verified at Chennai that the contents of paras 1 to 12 of the petition are true to my knowledge.',
      'I state that the facts stated in paras 1 to 12 of the petition above are true.',
    ].map((b, i) => (typeof b === 'string' ? { key: `v${i}`, text: b } : b));
    fetchQueue.push(anthropicReply([
      '1. The petitioner, Dinesh Kumar, aged 34, is a lorry driver residing at 47, Kamaraj Nagar, Avadi, Chennai.',
      '2. The offence is registered under BNS s.303(2) and BNS s.317(2).',
      '3. The petitioner was taken into custody on 2024-09-16 and, as on 2024-12-20, has been in custody for 96 days.',
      '4. That the charge sheet has been filed, so the investigation is complete.',
    ].join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const r = await intakeCompose.compose({
      docLabel: 'Writ Petition', docType: 'regular_bail', engineBlocks: blocks, facts: BAIL_FACTS, provider: 'anthropic',
    });
    expect(r.composed).toBe(true);
    expect(r.verification?.map((v) => v.to)).toEqual([
      'Verified at Chennai that the contents of paras 1 to 5 of the petition are true to my knowledge.',
      'I state that the facts stated in paras 1 to 5 of the petition above are true.',
    ]);
  });

  it('test_divorce_contested_verification_ranges_overlap: drops the skeleton-numbered legal-advice range (r12)', async () => {
    const blocks = [...BAIL,
      'Verified at Coimbatore that the contents of paras 1 to 9 are true to my knowledge and paras 10 to 11, if any, are true on legal advice received and believed to be true.',
    ].map((b, i) => (typeof b === 'string' ? { key: `v${i}`, text: b } : b));
    fetchQueue.push(anthropicReply([
      '1. The petitioner, Dinesh Kumar, aged 34, is a lorry driver residing at 47, Kamaraj Nagar, Avadi, Chennai.',
      '2. The offence is registered under BNS s.303(2) and BNS s.317(2).',
      '3. The petitioner was taken into custody on 2024-09-16 and, as on 2024-12-20, has been in custody for 96 days.',
    ].join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const r = await intakeCompose.compose({
      docLabel: 'Divorce', docType: 'regular_bail', engineBlocks: blocks, facts: BAIL_FACTS, provider: 'anthropic',
    });
    expect(r.verification?.map((v) => v.to)).toEqual([
      'Verified at Coimbatore that the contents of paras 1 to 4 are true to my knowledge and the legal submissions therein are true on legal advice received and believed to be true.',
    ]);
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

describe('numberBody — every pleading paragraph keeps a number', () => {
  it('test_plaint_keeps_para_12B: an inserted lettered paragraph keeps its label (s.12A mediation)', async () => {
    expect(numberBody(['12. The cause of action arose at Chennai.', '12B. No urgent interim relief is sought; pre-institution mediation under Section 12A was exhausted.', '13. Valuation.'], 12))
      .toEqual(['12. The cause of action arose at Chennai.', '12B. No urgent interim relief is sought; pre-institution mediation under Section 12A was exhausted.', '13. Valuation.']);
    const { guideFor } = await import('../intake-compose.service');
    expect(guideFor('plaint')).toContain('12B');
    expect(guideFor('succession_certificate')).toContain('Respondent 1');
    expect(guideFor('condone_delay_petition')).toContain('to be provided]');
  });

  it('re-numbers a paragraph whose numbered opening sentence was stripped', () => {
    expect(numberBody([
      '1. The Complainant is the payee.',
      'The above-named Complainant submits as follows:',
      '2. The cheque was dishonoured.',
      'The said notice was served on 24.03.2026.', // "3. …" sentence stripped by the checks
      '(a) Cheque No. 456789.',
      'GROUNDS',
      '5. The complaint is within time.',
    ], 1)).toEqual([
      '1. The Complainant is the payee.',
      'The above-named Complainant submits as follows:',
      '2. The cheque was dishonoured.',
      '3. The said notice was served on 24.03.2026.',
      '(a) Cheque No. 456789.',
      'GROUNDS',
      '4. The complaint is within time.',
    ]);
  });
});

describe('numberBody — a numbered list lead-in', () => {
  it('counts a numbered paragraph ending in ":" (it introduces the cheque list)', () => {
    expect(numberBody([
      '3. The loan was advanced.',
      '4. The Accused issued the following cheque:',
      '(a) Cheque No. 456789.',
      '4. The said cheque was issued towards the debt.',
      '11. The Complainant relies on:',
      '(a) The agreement.',
      '11. The Complainant craves leave.',
    ], 3).filter((p) => /^\d/.test(p)).map((p) => p.split('.')[0])).toEqual(['3', '4', '5', '6', '7']);
  });
});

describe('intake-compose — deep mode (authorities, plan, repair)', () => {
  const BNSS_480 = {
    cite: 'Section 480 of the Bharatiya Nagarik Suraksha Sanhita, 2023',
    heading: 'When bail may be taken in case of non-bailable offence',
    actPattern: 'BNSS|Bharatiya Nagarik Suraksha Sanhita',
    source: 'curated' as const,
  };
  const BODY_OK = [
    '1. The petitioner, Dinesh Kumar, aged 34, is a lorry driver residing at 47, Kamaraj Nagar, Avadi, Chennai.',
    '2. The offence is registered under BNS s.303(2) and BNS s.317(2).',
    '3. The petitioner was taken into custody on 2024-09-16 and, as on 2024-12-20, has been in custody for 96 days.',
  ];

  it('keeps a provision from the authority set when its Act is named, strips one from memory', async () => {
    fetchQueue.push(anthropicReply([
      ...BODY_OK,
      '4. That this Court has power to enlarge the petitioner on bail under Section 480 of the Bharatiya Nagarik Suraksha Sanhita, 2023.',
      '5. That Section 409 of the Indian Penal Code is not attracted.',
    ].join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const r = await intakeCompose.compose({
      docLabel: 'Regular Bail Application', docType: 'regular_bail', engineBlocks: BAIL, facts: BAIL_FACTS,
      authorities: [BNSS_480], provider: 'anthropic',
    });
    expect(r.composed).toBe(true);
    const text = r.blocks.map((b) => b.text).join(' ');
    expect(text).toContain('Section 480 of the Bharatiya Nagarik Suraksha Sanhita');
    expect(text).not.toContain('Section 409');
    // The authority reached the model.
    expect(JSON.stringify(fetchCalls[0]!.body)).toContain('Section 480 of the Bharatiya Nagarik Suraksha Sanhita');
  });

  it('strips an authority number cited against the wrong Act', async () => {
    fetchQueue.push(anthropicReply([...BODY_OK, '4. That Section 480 of the Companies Act applies.'].join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const r = await intakeCompose.compose({
      docLabel: 'Regular Bail Application', docType: 'regular_bail', engineBlocks: BAIL, facts: BAIL_FACTS,
      authorities: [BNSS_480], provider: 'anthropic',
    });
    expect(r.composed).toBe(true);
    expect(r.blocks.map((b) => b.text).join(' ')).not.toContain('Companies Act');
  });

  it('plans the grounds first and writes from the plan', async () => {
    fetchQueue.push(anthropicReply('{"grounds":[{"proposition":"Charge sheet filed; custody no longer needed","facts":["charge sheet filed"],"authority":"","answers":"tampering"}]}'));
    fetchQueue.push(anthropicReply(BODY_OK.join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const r = await intakeCompose.compose({
      docLabel: 'Regular Bail Application', docType: 'regular_bail', engineBlocks: BAIL, facts: BAIL_FACTS,
      plan: true, provider: 'anthropic',
    });
    expect(r.composed).toBe(true);
    expect(JSON.stringify(fetchCalls[1]!.body)).toContain('Charge sheet filed; custody no longer needed');
  });

  it('repairs a dropped particular instead of falling back to the skeleton', async () => {
    fetchQueue.push(anthropicReply(BODY_OK.map((p) => p.replace(' and BNS s.317(2)', '')).join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    fetchQueue.push(anthropicReply(BODY_OK.join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const r = await intakeCompose.compose({
      docLabel: 'Regular Bail Application', docType: 'regular_bail', engineBlocks: BAIL, facts: BAIL_FACTS,
      repair: true, provider: 'anthropic',
    });
    expect(r.composed).toBe(true);
    expect(r.blocks.map((b) => b.text).join(' ')).toContain('317(2)');
    expect(JSON.stringify(fetchCalls[2]!.body)).toContain('317(2)');
  });

  it('asks once to fill or name a "[to be drafted]" gap left in a passing draft (r7)', async () => {
    fetchQueue.push(anthropicReply([...BODY_OK, '4. Grounds: [to be drafted]'].join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    fetchQueue.push(anthropicReply([...BODY_OK, '4. The petitioner has been in custody for 96 days and is a lorry driver with a fixed abode.'].join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const r = await intakeCompose.compose({
      docLabel: 'Regular Bail Application', docType: 'regular_bail', engineBlocks: BAIL, facts: BAIL_FACTS,
      repair: true, provider: 'anthropic',
    });
    expect(r.composed).toBe(true);
    expect(r.blocks.map((b) => b.text).join(' ')).not.toContain('[to be drafted]');
    expect(JSON.stringify(fetchCalls[2]!.body)).toContain('Replace EVERY');
  });

  it('test_compose_no_bare_gap: settles every "[to be drafted]" left in a final body (r12)', () => {
    expect(settleGaps([
      '1. The marriage was solemnised at Salem.',
      '2. [to be drafted] The children of the marriage are none.',
      'SCHEDULE OF THE SUIT PROPERTY',
      '3. [to be drafted]',
      '4. Grounds: [to be drafted]',
      '5. The occasions on which the threats were made are [to be drafted].',
      '6. He paid nothing. [to be drafted] Hence this petition.',
      '7. [to be drafted]',
    ])).toEqual([
      '1. The marriage was solemnised at Salem.',
      '2. The children of the marriage are none.',
      '4. Grounds: [grounds to be provided]',
      '5. The occasions on which the threats were made are [particulars to be provided].',
      '6. He paid nothing. Hence this petition.',
    ]);
    // A para-wise reply keeps the number and names the hole.
    expect(settleGaps(['7. [to be drafted]'], true)).toEqual(['7. [reply to this paragraph to be provided]']);
    // "Smt." is not a sentence end: the cut takes the whole case reference, no "Smt. [gap]" stub.
    expect(sentencesOf('As held in Smt. Mayadevi v. Jagdish Prasad, cruelty is proved. Next.')).toHaveLength(2);
  });

  it('test_compose_restate_after_repair: still restates holes after a REPAIR, and the final body has none (r12)', async () => {
    const dropped = BODY_OK.map((p) => p.replace(' and BNS s.317(2)', '')).join('\n\n');
    fetchQueue.push(anthropicReply(dropped));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    fetchQueue.push(anthropicReply([...BODY_OK, '4. [to be drafted]', '5. Grounds: [to be drafted]'].join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    // RESTATE runs although REPAIR already succeeded; its answer still has one hole.
    fetchQueue.push(anthropicReply([...BODY_OK, '4. [to be drafted]', '5. The petitioner is a lorry driver with a fixed abode.'].join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const r = await intakeCompose.compose({
      docLabel: 'Regular Bail Application', docType: 'regular_bail', engineBlocks: BAIL, facts: BAIL_FACTS,
      repair: true, provider: 'anthropic',
    });
    expect(r.composed).toBe(true);
    expect(JSON.stringify(fetchCalls[4]!.body)).toContain('Replace EVERY');
    const texts = r.blocks.map((b) => b.text);
    expect(texts.join(' ')).not.toContain('[to be drafted]');
    // The emptied paragraph is dropped and the body renumbered.
    expect(texts).toContain('4. The petitioner is a lorry driver with a fixed abode.');
  });

  it('gets a second repair when the first still drops a particular (r9b)', async () => {
    const dropped = BODY_OK.map((p) => p.replace(' and BNS s.317(2)', '')).join('\n\n');
    fetchQueue.push(anthropicReply(dropped));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    fetchQueue.push(anthropicReply(dropped));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    fetchQueue.push(anthropicReply(BODY_OK.join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const r = await intakeCompose.compose({
      docLabel: 'Regular Bail Application', docType: 'regular_bail', engineBlocks: BAIL, facts: BAIL_FACTS,
      repair: true, provider: 'anthropic',
    });
    expect(r.composed).toBe(true);
    expect(r.blocks.map((b) => b.text).join(' ')).toContain('317(2)');
  });

  it('keeps a figure the advocate stated, but strips one from nowhere', async () => {
    fetchQueue.push(anthropicReply([...BODY_OK, '4. The petitioner repaid Rs. 75,000/- to the complainant. He later paid Rs. 9,99,000/- more.'].join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const r = await intakeCompose.compose({
      docLabel: 'Regular Bail Application', docType: 'regular_bail', engineBlocks: BAIL, facts: BAIL_FACTS,
      account: 'He says he repaid Rs. 75,000 to the complainant.', provider: 'anthropic',
    });
    expect(r.composed).toBe(true);
    const text = r.blocks.map((b) => b.text).join(' ');
    expect(text).toContain('75,000');
    expect(text).not.toContain('9,99,000');
  });

  it('keeps the compose when only a [gap] marker was not carried', async () => {
    const gapped = BAIL.map((b) => b.key === 'p6'
      ? { ...b, text: '5. Investigation status: [charge sheet status to be provided].' } : b);
    fetchQueue.push(anthropicReply(BODY_OK.join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const r = await intakeCompose.compose({
      docLabel: 'Regular Bail Application', docType: 'regular_bail', engineBlocks: gapped, facts: BAIL_FACTS, provider: 'anthropic',
    });
    expect(r.composed).toBe(true);
  });
});

describe('intake-compose — REPLY mode (written statement)', () => {
  const WS = [
    'WRITTEN STATEMENT ON BEHALF OF THE DEFENDANT',
    'PRELIMINARY OBJECTIONS:',
    '   1. The suit is barred by limitation.',
    'ON MERITS:',
    'Without prejudice to the preliminary objections stated above, the reply on merits is as under:',
    '   1. The averments in paragraph 1 are admitted.',
    '   2. The averments in paragraph 2 are denied.',
    '   3. The averments in paragraph 3 are not admitted.',
    'PRAYER:',
    '(a) dismiss the suit of the plaintiff;',
  ].map((text, i) => ({ key: `w${i}`, text }));

  it('flags a dropped reply, a new admission and a softened denial', () => {
    const body = WS.slice(5, 8).map((b) => b.text).join('\n');
    expect(replyDrift(body, ['1. Admitted.', '2. Denied specifically.', '3. Not admitted.'])).toBeNull();
    expect(replyDrift(body, ['1. Admitted.', '3. Not admitted.'])).toContain('dropped paragraph(s) 2');
    expect(replyDrift(body, ['1. Admitted.', '2. The defendant admits the loan.', '3. Not admitted.'])).toContain('stance of paragraph 2');
  });

  it('composes only the para-wise reply and keeps the plaint numbering', async () => {
    fetchQueue.push(anthropicReply([
      '1. The averments in paragraph 1 of the plaint are admitted.',
      '2. The averments in paragraph 2 of the plaint are denied. The defendant never borrowed from the plaintiff.',
      '3. The averments in paragraph 3 of the plaint are not admitted, and the plaintiff is put to strict proof.',
    ].join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const r = await intakeCompose.compose({
      docLabel: 'Written Statement', docType: 'written_statement', engineBlocks: WS, facts: {}, provider: 'anthropic',
    });
    expect(r.composed).toBe(true);
    const texts = r.blocks.map((b) => b.text);
    expect(texts[2]).toBe('   1. The suit is barred by limitation.'); // preliminary objections untouched
    expect(texts.filter((t) => /^2\. /.test(t))[0]).toContain('never borrowed');
    expect(texts.at(-1)).toBe('(a) dismiss the suit of the plaintiff;');
  });
});

describe('composeNoticeFor', () => {
  it('explains a fallback in plain words, and says nothing for a composed draft', () => {
    expect(composeNoticeFor({ blocks: [], composed: true, modelUsed: 'x' })).toBeNull();
    expect(composeNoticeFor({ blocks: [], composed: false, modelUsed: 'x', rejectedReason: 'dropped from the skeleton: s.317(2)' }))
      .toContain('s.317(2)');
  });
});

describe('intake-compose — a numbered party list in the cause title is not the body', () => {
  const WRIT = [
    'IN THE HIGH COURT OF MADRAS',
    'Tmt. P. Revathi ... PETITIONER',
    'VERSUS',
    '1. The District Collector, Salem',
    '2. The Tahsildar, Salem Taluk ... RESPONDENTS',
    'MOST RESPECTFULLY SHOWETH:',
    '1. The petitioner has the locus standi to maintain this petition.',
    '2. [to be drafted]',
    'PRAYER:',
    '(a) issue a Writ of mandamus;',
  ].map((text, i) => ({ key: `r${i}`, text }));

  it('composes the body after SHOWETH and leaves the respondents untouched', async () => {
    fetchQueue.push(anthropicReply('1. The petitioner has the locus standi to maintain this petition, being the lessee.\n\n2. The renewal application was kept pending without reasons.'));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const r = await intakeCompose.compose({
      docLabel: 'Writ Petition', docType: 'writ_petition', engineBlocks: WRIT, facts: {}, provider: 'anthropic',
    });
    expect(r.composed).toBe(true);
    const texts = r.blocks.map((b) => b.text);
    expect(texts.slice(0, 6)).toEqual(WRIT.slice(0, 6).map((b) => b.text));
    expect(r.splice?.start).toBe(6);
    expect(texts).toContain('2. The renewal application was kept pending without reasons.');
  });
});

describe('intake-compose — judgments come only from the corpus', () => {
  const BODY_OK = [
    '1. The petitioner, Dinesh Kumar, aged 34, is a lorry driver residing at 47, Kamaraj Nagar, Avadi, Chennai.',
    '2. The offence is registered under BNS s.303(2) and BNS s.317(2).',
    '3. The petitioner was taken into custody on 2024-09-16 and, as on 2024-12-20, has been in custody for 96 days.',
  ];
  const VIJAY = {
    cite: 'Vijay Singh @ Vijay Kr. Sharma v. The State of Bihar, 2024 INSC 735',
    court: 'Supreme Court of India', decisionDate: '2024-09-25', paraNo: 32,
    excerpt: 'Once the charge sheet is filed, continued custody serves no investigative purpose.',
    url: 'https://indian-supreme-court-judgments.s3.amazonaws.com/x.pdf',
  };

  it('keeps a retrieved judgment, strips an invented one, and lists what was cited', async () => {
    fetchQueue.push(anthropicReply('{"grounds":[{"proposition":"Charge sheet filed; custody serves no purpose","facts":[],"authority":"","answers":""}]}'));
    fetchQueue.push(anthropicReply([
      ...BODY_OK,
      '4. That custody serves no purpose after the charge sheet, as held in Vijay Singh @ Vijay Kr. Sharma v. The State of Bihar, 2024 INSC 735.',
      '5. That bail is the rule, as held in Sanjay Chandra v. CBI, (2012) 1 SCC 40.',
    ].join('\n\n')));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    let asked: string[] = [];
    const r = await intakeCompose.compose({
      docLabel: 'Regular Bail Application', docType: 'regular_bail', engineBlocks: BAIL, facts: BAIL_FACTS,
      plan: true, provider: 'anthropic',
      findJudgments: async (g) => { asked = g; return [VIJAY]; },
    });
    expect(asked).toEqual(['Charge sheet filed; custody serves no purpose']);
    expect(r.composed).toBe(true);
    const text = r.blocks.map((b) => b.text).join(' ');
    expect(text).toContain('2024 INSC 735');
    expect(text).not.toContain('Sanjay Chandra');
    expect(r.addedAuthorities?.map((a) => a.source)).toContain('judgment');
    expect(JSON.stringify(fetchCalls[1]!.body)).toContain('JUDGMENT');
  });
});

describe('unauthorisedCases — cases named without "v."', () => {
  it('strips "held in Pranay Sethi" and "(supra)" but keeps statutory references', async () => {
    const { unauthorisedCases } = await import('../../lib/compose-authorities');
    const bad = unauthorisedCases([
      'Compensation must follow the principles laid down in Pranay Sethi. The claim is under Section 166 of the Motor Vehicles Act.',
      'The exceptions laid down in Alka Subhash Gadia apply. This is as held in Section 13 of the Act.',
      'Rajnesh (supra) governs interim maintenance. The order in Crime No. 45 of 2025 is challenged.',
    ], [], ['']);
    expect(bad).toEqual([
      'Compensation must follow the principles laid down in Pranay Sethi.',
      'The exceptions laid down in Alka Subhash Gadia apply.',
      'Rajnesh (supra) governs interim maintenance.',
    ]);
  });
});

describe('composeNoticeFor — reply-mode rejection', () => {
  it('names the real cause, not "fact-check unavailable"', () => {
    const n = composeNoticeFor({ blocks: [], composed: false, modelUsed: 'x', rejectedReason: 'reply changed the stance of paragraph 2' });
    expect(n).toContain('changed the stance of paragraph 2');
    expect(n).not.toContain('unavailable');
  });
});

describe('gatherAuthorities — subject Acts', () => {
  it('test_s138_reply_money_lenders_act: offers the TN Money-Lenders Act only when the brief raises no licence (r12)', async () => {
    const { gatherAuthorities } = await import('../../lib/compose-authorities');
    const cite = 'the Tamil Nadu Money-Lenders Act, 1957';
    const withPoint = await gatherAuthorities({ docType: 's138_reply', docLabel: 'Reply', facts: {}, account: 'Kannappan has no money-lending licence' });
    expect(withPoint.map((a) => a.cite)).toContain(cite);
    const without = await gatherAuthorities({ docType: 's138_reply', docLabel: 'Reply', facts: {}, account: 'he never borrowed any money' });
    expect(without.map((a) => a.cite)).not.toContain(cite);
  });

  it('test_civil_revision_expert_opinion_basis: offers s.39 BSA when a handwriting-expert reference was refused (r12)', async () => {
    const { gatherAuthorities } = await import('../../lib/compose-authorities');
    const crp = await gatherAuthorities({ docType: 'civil_revision', docLabel: 'CRP', facts: {}, account: 'application to send the disputed signature to a handwriting expert was dismissed' });
    expect(crp.map((a) => a.cite)).toContain('Section 39 of the Bharatiya Sakshya Adhiniyam, 2023');
  });

  it('offers the TN Patta Pass Book Act for a patta matter, and not otherwise', async () => {
    const { gatherAuthorities } = await import('../../lib/compose-authorities');
    const withPatta = await gatherAuthorities({ docType: 'writ_petition', docLabel: 'Writ', facts: {}, account: 'applied for transfer of patta in his name' });
    expect(withPatta.map((a) => a.cite)).toContain('the Tamil Nadu Patta Pass Book Act, 1983');
    const without = await gatherAuthorities({ docType: 'writ_petition', docLabel: 'Writ', facts: {}, account: 'pension not paid' });
    expect(without.map((a) => a.cite)).not.toContain('the Tamil Nadu Patta Pass Book Act, 1983');
  });
});

describe('guardRecalledCases — the AI fallback path', () => {
  it('removes an uncited case name and flags a cited one for verification', async () => {
    const { guardRecalledCases } = await import('../../lib/compose-authorities');
    const r = guardRecalledCases([
      '13. Whitney Pex Mills v. Commissioner of Income Tax is relied on. An alternative remedy is not a bar.',
      '14. The Petitioner relies on Whirlpool Corporation v. Registrar of Trade Marks, (1998) 8 SCC 1.',
      '15. No case law here.',
    ]);
    expect(r.paragraphs[0]).toContain('[authority to be cited]');
    expect(r.paragraphs[0]).not.toContain('Whitney');
    expect(r.paragraphs[0]).toContain('An alternative remedy is not a bar.');
    expect(r.paragraphs[1]).toContain('(1998) 8 SCC 1 [verify citation]');
    expect(r.paragraphs[2]).toBe('15. No case law here.');
  });
});

describe('r13 compose defects', () => {
  it('test_writ_petition_paragraph_labels_in_order: a lettered label out of place is numbered in sequence', () => {
    expect(numberBody(['1. Parties.', '2. Facts.', 'GROUNDS:', 'A. Ground one.', '6A. The petitioner has a legal right.', '6. ALTERNATIVE REMEDY: none lies.'], 1))
      .toEqual(['1. Parties.', '2. Facts.', 'GROUNDS:', 'A. Ground one.', '3. The petitioner has a legal right.', '4. ALTERNATIVE REMEDY: none lies.']);
  });

  it('test_condone_delay_petition_no_estimated_delay: the account\'s "about 115 days" is cut beside the computed 118', async () => {
    const blocks = [
      { key: 'h', text: 'PETITION UNDER SECTION 5 OF THE LIMITATION ACT, 1963 TO CONDONE THE DELAY OF 118 DAYS' },
      { key: 'p1', text: '1. There is a delay of 118 days in filing the appeal.' },
      { key: 'p2', text: '2. The delay was due to illness.' },
    ];
    fetchQueue.push(anthropicReply('1. There is a delay of 118 days in filing the appeal. The appeal is filed with a delay of about 115 days, and the petitioner prays that the entire period be condoned.\n\n2. The delay was due to illness.'));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const result = await intakeCompose.compose({
      docLabel: 'Condone delay petition', docType: 'condone_delay_petition', engineBlocks: blocks,
      facts: { Petitioner: 'Mrs. P. Meena' }, account: 'It is being filed now, with a delay of about 115 days.', provider: 'anthropic',
    });
    expect(result.composed).toBe(true);
    const text = result.blocks.map((b) => b.text).join('\n');
    expect(text).toContain('delay of 118 days');
    expect(text).not.toContain('115');
  });

  it('test_consumer_complaint_account_numbers_may_be_stated: the Facts header does not forbid the account\'s complaint IDs', async () => {
    fetchQueue.push(anthropicReply('1. Three service visits under complaint IDs CW55102, CW55877 and CW56340 failed.'));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const result = await intakeCompose.compose({
      docLabel: 'Consumer complaint', docType: 'consumer_complaint',
      engineBlocks: [{ key: 'p5', text: '5. [to be drafted]' }],
      facts: { Complainant: 'Mr. H. Balaji' }, account: 'three service visits (complaint IDs CW55102, CW55877, CW56340) failed', provider: 'anthropic',
    });
    const user = JSON.stringify(fetchCalls[0]!.body);
    expect(user).toContain("# Facts (with the advocate's account, the ONLY dates, amounts and numbers you may state)");
    expect(result.blocks.map((b) => b.text).join('\n')).toContain('CW55102');
  });
});

describe('r14 compose defects', () => {
  it('test_criminal_revision_lettered_ground_keeps_text: "D. <ground>" keeps its text; a cut ground leaves no "9. D."', () => {
    const settled = settleGaps([
      '4. The petitioner does not ask for a reweighing of evidence.',
      '5. [to be drafted] He may show that the debt did not exist. He is not expected to prove it beyond doubt. A complainant who keeps no accounts has not shown the debt.',
      'GROUNDS:',
      'A. The courts below failed to consider the defence.',
      'B. The courts below failed to consider the admission.',
      'C. [to be drafted]',
      'D. The courts below held the presumption unrebutted without dealing with the admissions.',
      'E. [to be drafted]',
      '6. No appeal lies against the impugned order.',
    ]);
    expect(numberBody(settled, 1)).toEqual([
      '1. The petitioner does not ask for a reweighing of evidence.',
      '2. A complainant who keeps no accounts has not shown the debt.',
      'GROUNDS:',
      'A. The courts below failed to consider the defence.',
      'B. The courts below failed to consider the admission.',
      'C. The courts below held the presumption unrebutted without dealing with the admissions.',
      '3. No appeal lies against the impugned order.',
    ]);
  });

  it('test_condone_delay_petition_gap_periods_restored: a dropped dated gap goes back, sub-items re-lettered', () => {
    const skeleton = '4. [to be drafted] [cause of delay from 12.07.2026 to 20.07.2026 to be provided] [cause of delay from 08.10.2026 to 07.11.2026 to be provided]';
    const restored = restoreDatedGaps([
      '3. The delay is explained below.',
      '(a) 20.07.2026 to 02.09.2026: The petitioner was in hospital.',
      '(c) 26.09.2026 to 08.10.2026: Certified copies were obtained.',
      '4. The last day for filing was 12.07.2026.',
    ], skeleton);
    const out = numberBody(restored, 3);
    expect(out[2]).toBe('(b) 26.09.2026 to 08.10.2026: Certified copies were obtained. [cause of delay from 08.10.2026 to 07.11.2026 to be provided]');
    expect(out[3]).toBe('4. The last day for filing was 12.07.2026. [cause of delay from 12.07.2026 to 20.07.2026 to be provided]');
    // an explained gap (both dates in one sentence) is left alone
    expect(restoreDatedGaps(['From 08.10.2026 to 07.11.2026 the papers were prepared.'], skeleton.split(' [cause of delay from 12')[0] + ' [cause of delay from 08.10.2026 to 07.11.2026 to be provided]'))
      .toEqual(['From 08.10.2026 to 07.11.2026 the papers were prepared.']);
  });

  it('test_judicial_separation_no_invented_registration: "not registered" is cut unless the advocate raised it', async () => {
    const blocks = [
      { key: 'h', text: 'PETITION UNDER SECTION 10 OF THE HINDU MARRIAGE ACT, 1955' },
      { key: 'p1', text: '1. The marriage was solemnised on 07.09.2012 at Tirunelveli.' },
      { key: 'p2', text: '2. The respondent treated the petitioner with cruelty.' },
    ];
    fetchQueue.push(anthropicReply('1. The marriage was solemnised on 07.09.2012 at Tirunelveli. The marriage was not registered.\n\n2. The respondent treated the petitioner with cruelty. For religious reasons she does not seek a divorce.'));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const result = await intakeCompose.compose({
      docLabel: 'Judicial Separation Petition', docType: 'judicial_separation', engineBlocks: blocks,
      facts: { Petitioner: 'Mrs. R. Gomathi' }, account: 'Married under Hindu rites; for religious reasons she does not want a divorce.', provider: 'anthropic',
    });
    const text = result.blocks.map((b) => b.text).join('\n');
    expect(text).not.toContain('not registered');
    expect(text).toContain('For religious reasons she does not seek a divorce.');
  });

  it('test_indigent_application_plaint_verification_count_kept: the annexed plaint keeps its own paragraph count', async () => {
    const blocks = [
      { key: 'h', text: 'MOST RESPECTFULLY SHOWETH:' },
      { key: 'p1', text: '1. The petitioner is a widow.' },
      { key: 'p2', text: '2. She is an indigent person.' },
      { key: 'v', text: 'Verified at Kallakurichi that the contents of paragraphs 1 to 4 of the plaint are true.' },
    ];
    fetchQueue.push(anthropicReply('1. The petitioner is a widow.\n\n2. She is an indigent person.\n\n3. She undertakes to pay the court fee.'));
    fetchQueue.push(anthropicReply('{"pass": true, "unsupported_claims": []}'));
    const result = await intakeCompose.compose({
      docLabel: 'Application to Sue as an Indigent Person', docType: 'indigent_application', engineBlocks: blocks,
      facts: { Petitioner: 'Mrs. V. Selvi' }, provider: 'anthropic',
    });
    expect(result.blocks.map((b) => b.text).join('\n')).toContain('paragraphs 1 to 4 of the plaint');
  });
});

describe('r15 compose defects', () => {
  it('test_dv_application_must_plead_s3_s17_s27: a thinned body is told the statutory heads', () => {
    const g = guideFor('dv_application');
    expect(g).toContain('Section 3 of the Act');
    expect(g).toContain('Section 17 of the Act');
    expect(g).toContain('Section 27 of the Act');
  });

  it('test_condone_delay_petition_sub_items_relettered_from_any_start: (b)(d)(e)(g) -> (a)..(d); roman lists untouched', () => {
    expect(numberBody(['3. Explanation:', '(b) Hospital.', '(d) Counsel approached.', '(e) Copies.', '(g) Filed.'], 3))
      .toEqual(['3. Explanation:', '(a) Hospital.', '(b) Counsel approached.', '(c) Copies.', '(d) Filed.']);
    expect(numberBody(['3. Lead:', '(i) One.', '(ii) Two.', '(iii) Three.', '(iv) Four.', '(v) Five.'], 3))
      .toEqual(['3. Lead:', '(i) One.', '(ii) Two.', '(iii) Three.', '(iv) Four.', '(v) Five.']);
  });

  it('test_condone_delay_petition_sub_item_keeps_content_after_cut_opener: label and remaining facts survive', () => {
    const settled = settleGaps(['3. The delay is explained below.', '(a) [to be drafted] He fell ill and did not apply for the decree copy.', '(b) [to be drafted]', '(c) 20.07.2026 to 02.09.2026: In hospital.']);
    expect(numberBody(settled, 3)).toEqual([
      '3. The delay is explained below.',
      '(a) He fell ill and did not apply for the decree copy.',
      '(b) 20.07.2026 to 02.09.2026: In hospital.',
    ]);
  });

  it('test_condone_delay_petition_gap_periods_always_named: every engine stretch is restored after compose', () => {
    const skeleton = '4. The earlier counsel fell ill. [cause of delay from 12.07.2026 to 20.07.2026 to be provided] [cause of delay from 08.10.2026 to 08.11.2026 to be provided]';
    const out = numberBody(restoreDatedGaps(settleGaps([
      '3. The explanation, in date order:',
      '(b) 20.07.2026 to 02.09.2026: The petitioner was in hospital.',
      '(e) Certified copies were applied for on 26.09.2026 and received on 08.10.2026.',
      '4. The last day for filing was 12.07.2026.',
    ]), skeleton), 3).join('\n');
    expect(out).toContain('[cause of delay from 12.07.2026 to 20.07.2026 to be provided]');
    expect(out).toContain('(b) Certified copies were applied for on 26.09.2026 and received on 08.10.2026. [cause of delay from 08.10.2026 to 08.11.2026 to be provided]');
  });

  it('test_criminal_revision_para1_keeps_impugned_identification: "By that judgment" gets its antecedent back', () => {
    const skel = '1. This revision is directed against the judgment dated 30.09.2026 passed by the Additional District and Sessions Court, Srivilliputhur in C.A. No. 22 of 2025, which is not an interlocutory order.';
    const out = anchorOpening(['1. By that judgment the Sessions Court dismissed his appeal.', '2. Address.'], skel);
    expect(out[0]).toBe('1. This revision is directed against the judgment dated 30.09.2026 passed by the Additional District and Sessions Court, Srivilliputhur in C.A. No. 22 of 2025, which is not an interlocutory order. By that judgment the Sessions Court dismissed his appeal.');
    const kept = ['1. The petitioner challenges the judgment in C.A. No. 22 of 2025 dated 30.09.2026.'];
    expect(anchorOpening(kept, skel)).toEqual(kept);
  });

  it('test_criminal_revision_ground_fragment_dropped: a cut opener takes "for this purpose ..." with it', () => {
    const settled = settleGaps([
      'A. The courts below failed to consider the defence.',
      'D. [to be drafted] The accused was not bound to lead further evidence for this purpose, and the courts below erred.',
      'E. Both courts held the presumption unrebutted.',
    ]);
    expect(numberBody(settled, 1)).toEqual(['A. The courts below failed to consider the defence.', 'B. Both courts held the presumption unrebutted.']);
  });
});
