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

import { intakeCompose, numberBody, segmentBlocks, replyDrift, composeNoticeFor } from '../intake-compose.service';

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
