import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractionPatch } from '../intake-llm.service';

// anthropic-client reads its key pool once at import; the attachment tests
// set a key later, so without this they only passed with a real key in .env.
vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY ||= 'test-key';
});

// The orchestrator's guarantees, tested WITHOUT a live engine or LLM: we mock
// the engine client (the authority on 422/refused/generated) and the intake LLM
// (extract + phrase), and drive the loop across turns. The fact sheet uses its
// in-memory fallback (no DB in the test env).

// ---- mock the engine client: a scripted queue of outcomes ------------------
type Outcome =
  | { kind: 'issues'; issues: Array<{ field: string; code: string; message: string }> }
  | { kind: 'refused'; refusal: Record<string, unknown> }
  | { kind: 'generated' };

const engineQueue: Outcome[] = [];
const draftCalls: Array<Record<string, unknown>> = [];

vi.mock('../engine-client.service', () => {
  class EngineValidationError extends Error {
    constructor(public issues: Array<{ field: string; code: string; message: string }>) {
      super('validation');
      this.name = 'EngineValidationError';
    }
  }
  class EngineDisabledError extends Error {}
  return {
    EngineValidationError,
    EngineDisabledError,
    EngineError: class extends Error {},
    engineClient: {
      // Minimal describe() for the passthrough s138_complaint doc so resolveDoc can
      // derive its intake sections. Only the fields the attach-auto-list test needs.
      async docTypes() {
        return {
          doc_types: [
            {
              doc_type: 's138_complaint',
              title: 'Complaint under s.138 NI Act',
              slots: [],
              fields: [
                { key: 'complainant_name', kind: 'string', required: true },
                { key: 'extra_documents', kind: 'string_list', required: false },
              ],
            },
          ],
        };
      },
      async draft(docType: string, matterId: string, fields: Record<string, unknown>) {
        draftCalls.push({ ...fields });
        const next = engineQueue.shift();
        if (!next) throw new Error('engine queue empty — test under-scripted');
        if (next.kind === 'issues') throw new EngineValidationError(next.issues);
        if (next.kind === 'refused') {
          return { outcome: 'refused', docType, refusal: next.refusal };
        }
        return {
          outcome: 'generated', docType,
          signals: { review_banner: 'REVIEW BEFORE FILING', unverified_marker: '' },
          unfilledSlots: [], blocks: [{ key: 'body', text: 'DRAFT' }], docxBase64: null,
          templateId: `${docType}.docx`, templateVersion: 1,
        };
      },
    },
  };
});

// ---- mock the intake LLM: scripted extract patches + a phraser -------------
const extractQueue: ExtractionPatch[] = [];
const extractCalls: string[] = []; // the `latest` text each LLM extract call received

vi.mock('../intake-llm.service', () => ({
  intakeLlm: {
    async extract(args: { latest: string }) {
      extractCalls.push(args.latest);
      return (
        extractQueue.shift() ?? {
          fields: [], unmappedNotes: [], lowConfidence: [], collisions: [], modelUsed: 'fallback:none',
        }
      );
    },
    // The phraser echoes each issue as a trivial question tagged with its field.
    async phrase(args: { issues: Array<{ field: string }> }) {
      return args.issues.map((i) => ({ field: i.field, question: `Q:${i.field}?` }));
    },
    // The classifier returns a scripted label (or null → caller keyword-falls back).
    async classifyDocType() {
      classifyCalls.push(1);
      return classifyQueue.shift() ?? { label: null, confidence: 'low' as const };
    },
  },
  // markSyntheticDates (intake.service) imports MONTH_NAMES from this module, so the
  // mock — a whitelist of what the module exports — must provide it too.
  MONTH_NAMES: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
}));

const classifyQueue: Array<{ label: string | null; confidence: 'high' | 'medium' | 'low' }> = [];

// ---- mock intake-compose: default PASS-THROUGH (no network calls in tests) -
// Real compose behaviour is unit-tested in intake-compose.service.test.ts.
// Here we default to composed:false (the engine's own plain blocks unchanged)
// so every existing test's assertions about `state.draft.blocks` keep holding;
// a few dedicated tests below override this queue to prove the wiring.
const composeQueue: Array<{ composed: boolean; blocks: Array<{ key: string; text: string }>; rejectedReason?: string }> = [];
const composeCalls: Array<{ engineBlocks: Array<{ key: string; text: string }>; facts: Record<string, string> }> = [];
vi.mock('../intake-compose.service', () => ({
  intakeCompose: {
    async compose(args: { engineBlocks: Array<{ key: string; text: string }>; facts: Record<string, string> }) {
      composeCalls.push({ engineBlocks: args.engineBlocks, facts: args.facts });
      const scripted = composeQueue.shift();
      if (scripted) return { ...scripted, modelUsed: 'test:compose' };
      return { composed: false, blocks: args.engineBlocks, modelUsed: 'engine:template' };
    },
  },
  composeNoticeFor: (r: { composed: boolean; rejectedReason?: string }) =>
    (r.composed || !r.rejectedReason ? null : `plain draft: ${r.rejectedReason}`),
  guideFor: () => 'guide',
}));
// Authority retrieval would query the statute corpus — no network/DB in tests.
vi.mock('../../lib/compose-authorities', () => ({
  gatherAuthorities: async () => [],
  authoritiesBlock: () => '(none)',
  guardRecalledCases: (paragraphs: string[]) => ({ paragraphs, flagged: 0, removed: [] }),
}));
vi.mock('../judgments.service', () => ({ judgmentsService: { forGrounds: async () => [] } }));
vi.mock('../compose-outcomes.service', () => ({ composeOutcomesService: { record: () => {} }, reasonKindOf: () => 'unavailable' }));
const classifyCalls: number[] = [];

// The attachment path is FREE + LOCAL: images go to tesseract OCR, pdf/docx to
// text-extraction, and the resulting text is mapped by the DETERMINISTIC rule
// extractor. Mock all three so tests don't need real file bytes / a real worker,
// and so we can script exactly what each "document" yields as text and fields.
const ocrQueue: Array<{ ok: true; text: string } | { ok: false; error: string }> = [];
const ocrCalls: number[] = []; // buffer lengths, one per ocrImage call
vi.mock('../../lib/image-ocr', () => ({
  ocrImage: async (buf: Buffer) => {
    ocrCalls.push(buf.length);
    return ocrQueue.shift() ?? { ok: false, error: 'no text' };
  },
  terminateOcr: async () => {},
}));

const textExtractQueue: Array<{ ok: true; text: string } | { ok: false; error: string }> = [];
vi.mock('../../lib/text-extraction', () => ({
  extractText: async () =>
    textExtractQueue.shift() ?? { ok: false, error: 'unsupported' },
  SUPPORTED_NOTE_MIME_TYPES: [],
}));

// The deterministic extractor maps document text -> field patch (confidence
// 'stated'; the service re-marks it 'inferred'). Script its output per call.
const detQueue: ExtractionPatch[] = [];
const detCalls: string[] = []; // the `latest` text each call received
vi.mock('../intake-extract-rules.service', () => ({
  extractDeterministic: (args: { latest: string; answering: string[] }) => {
    detCalls.push(args.latest);
    const scripted = detQueue.shift();
    if (scripted) return scripted;
    // Mirror the REAL extractor's bare-answer fallback: a short reply answering
    // exactly one asked field is assigned to it. This lets the loop tests exercise
    // the pending→answering wiring without the full rule engine.
    const words = args.latest.trim().split(/\s+/).filter(Boolean);
    if (args.answering?.length === 1 && words.length > 0 && words.length <= 8) {
      return { fields: [{ key: args.answering[0]!, value: args.latest.trim(), confidence: 'stated' as const, source: args.latest.trim() }],
               unmappedNotes: [], lowConfidence: [], collisions: [], modelUsed: 'deterministic:rules' };
    }
    return { fields: [], unmappedNotes: [], lowConfidence: [], collisions: [], modelUsed: 'deterministic:none' };
  },
}));

// ai-usage is fire-and-forget; stub it so no DB is touched.
vi.mock('../ai-usage.service', () => ({ aiUsageService: { recordAsync: () => {} } }));

// The draft-first fallback (aiFallbackDraft) calls Claude; tests script it.
const claudeQueue: Array<string | Error> = [];
vi.mock('../../lib/anthropic-client', () => ({
  claudeComplete: async () => {
    const next = claudeQueue.shift();
    if (next === undefined || next instanceof Error) throw next ?? new Error('claude unavailable');
    return { text: next, tokensIn: 1, tokensOut: 1 };
  },
}));
// The fallback drafts through the OpenAI-compatible slot when the local .env
// picks it (LLM_PROVIDER=xai); script it from the same queue.
vi.mock('../../lib/grok-client', () => ({
  grokComplete: async () => {
    const next = claudeQueue.shift();
    if (next === undefined || next instanceof Error) throw next ?? new Error('llm unavailable');
    return { text: next, tokensIn: 1, tokensOut: 1 };
  },
}));

import { intakeService, markSyntheticDates, placeholderFor } from '../intake.service';
import { factSheetService } from '../factsheet.service';
import { env } from '../../env';

const DOC = 'Notice u/s 138 NI Act';
const CTX = { firmId: 'firm1', userId: 'user1' as string };

function patch(fields: ExtractionPatch['fields']): ExtractionPatch {
  return { fields, unmappedNotes: [], lowConfidence: [], collisions: [], modelUsed: 'test' };
}

// This suite MOCKS the intake LLM (extract + phrase), so it exercises the LLM
// extraction path on purpose. Force intakeDeterministic:false for the duration so
// the tests are independent of the ambient .env flag (which is `true` while the
// deterministic extractor is rolled out) — otherwise the mocked extract queue is
// bypassed and relative-date derivations (e.g. "yesterday") never populate.
const _origDeterministic = env.intakeDeterministic;

beforeEach(() => {
  engineQueue.length = 0;
  extractQueue.length = 0;
  extractCalls.length = 0;
  classifyQueue.length = 0;
  classifyCalls.length = 0;
  ocrQueue.length = 0;
  ocrCalls.length = 0;
  textExtractQueue.length = 0;
  detQueue.length = 0;
  detCalls.length = 0;
  draftCalls.length = 0;
  composeQueue.length = 0;
  composeCalls.length = 0;
  factSheetService._resetMemory();
  (env as { intakeDeterministic: boolean }).intakeDeterministic = false;
});

afterEach(() => {
  (env as { intakeDeterministic: boolean }).intakeDeterministic = _origDeterministic;
});

describe('intake loop — the engine decides, the model phrases', () => {
  it('phrases only the engine-reported missing fields, the 3 most important first', async () => {
    // The advocate names the payee; the engine still wants several fields.
    extractQueue.push(patch([{ key: 'sender_name', value: 'Mehta Enterprises', confidence: 'stated', source: 'payee is Mehta' }]));
    // The engine wants FOUR more fields; the loop asks the THREE most important
    // this turn (essentials first), never inventing one.
    engineQueue.push({
      kind: 'issues',
      issues: [
        { field: 'place', code: 'required', message: 'x' },
        { field: 'recipient_name', code: 'required', message: 'x' },
        { field: 'cheques[0].number', code: 'required', message: 'x' },
        { field: 'cheques[0].amount', code: 'required', message: 'x' },
      ],
    });
    const state = await intakeService.start(DOC, 'The payee is Mehta Enterprises.', CTX);

    expect(state.status).toBe('gathering');
    // THREE questions this turn (the top-3 essentials), each a field the engine
    // actually asked for (never invented).
    expect(state.questions).toHaveLength(3);
    const askedFields = state.questions.map((q) => q.field);
    for (const f of askedFields) {
      expect(['recipient_name', 'cheque_no', 'cheque_amount', 'place']).toContain(f);
    }
    // 'place' is the LEAST important of the four → it waits; the party + cheque
    // fields lead. So 'place' is NOT among this turn's three.
    expect(askedFields).not.toContain('place');
    // The value we extracted IS in the fact sheet, marked stated.
    const senderField = state.factSheet.flatMap((s) => s.fields).find((f) => f.key === 'sender_name');
    expect(senderField?.value).toBe('Mehta Enterprises');
    expect(senderField?.meta?.confidence).toBe('stated');
  });

  it('folds engine keys into one form-field question (bank + branch)', async () => {
    extractQueue.push(patch([]));
    engineQueue.push({
      kind: 'issues',
      issues: [
        { field: 'cheques[0].bank', code: 'required', message: 'x' },
        { field: 'cheques[0].branch', code: 'required', message: 'x' },
      ],
    });
    const state = await intakeService.start(DOC, 'Hello.', CTX);
    // Two engine issues, ONE form field (drawee_bank) -> one question.
    expect(state.questions).toHaveLength(1);
    expect(state.questions[0]!.field).toBe('drawee_bank');
  });

  it('marks a derived value and does NOT block the draft on it', async () => {
    extractQueue.push(
      patch([
        {
          key: 'memo_received_date', value: '2026-08-31', confidence: 'inferred',
          source: 'memo came yesterday', derivation: "'yesterday' relative to 2026-09-01",
        },
      ]),
    );
    engineQueue.push({ kind: 'issues', issues: [{ field: 'notice_date', code: 'required', message: 'x' }] });
    const state = await intakeService.start(DOC, 'The memo came yesterday.', CTX);
    const field = state.factSheet.flatMap((s) => s.fields).find((f) => f.key === 'memo_received_date');
    expect(field?.value).toBe('2026-08-31');
    expect(field?.meta?.confidence).toBe('inferred');
    expect(field?.meta?.derivation).toContain('yesterday');
    // Derived value is present and usable — it did NOT prevent gathering.
    expect(state.status).toBe('gathering');
  });

  it('surfaces a contradiction as a note and takes the new value', async () => {
    extractQueue.push(patch([{ key: 'cheque_amount', value: '475000', confidence: 'stated', source: '4.75 lakh' }]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'notice_date', code: 'required', message: 'x' }] });
    let state = await intakeService.start(DOC, 'Cheque was 4.75 lakh.', CTX);

    extractQueue.push(patch([{ key: 'cheque_amount', value: '500000', confidence: 'stated', source: 'actually 5 lakh' }]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'notice_date', code: 'required', message: 'x' }] });
    state = await intakeService.reply(state.matterId, DOC, 'Actually it was 5 lakh.', CTX);

    const field = state.factSheet.flatMap((s) => s.fields).find((f) => f.key === 'cheque_amount');
    expect(field?.value).toBe('500000'); // new value wins
    // A note recorded the change (never a silent overwrite).
    const noteTurn = state.transcript.find((t) => t.kind === 'note' && t.text.includes('change'));
    expect(noteTurn?.text).toContain('475000');
    expect(noteTurn?.text).toContain('500000');
  });

  it('on refusal: delivers the finding, stops asking, but keeps listening', async () => {
    extractQueue.push(patch([{ key: 'cheque_date', value: '2020-01-01', confidence: 'stated', source: 'old cheque' }]));
    engineQueue.push({
      kind: 'refused',
      refusal: {
        code: 's138_notice_cheque_presented_after_validity', severity: 'HARD',
        reason: 'The cheque was presented after its validity.', computation: null,
        pipeline: 's138_notice', spec: '2.2', fields_implicated: ['cheque_date'], remedy_hint: 'none',
      },
    });
    let state = await intakeService.start(DOC, 'An old cheque from 2020.', CTX);

    expect(state.status).toBe('refused');
    expect(state.refusal?.code).toBe('s138_notice_cheque_presented_after_validity');
    // PAUSE interrogation: no new questions while the finding stands.
    expect(state.questions).toHaveLength(0);

    // KEEP LISTENING: a correction still flows and is re-evaluated. This time the
    // engine accepts and asks for the next field (the pause lifts).
    extractQueue.push(patch([{ key: 'cheque_date', value: '2026-08-10', confidence: 'stated', source: 'recent cheque' }]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'notice_date', code: 'required', message: 'x' }] });
    state = await intakeService.reply(state.matterId, DOC, 'Sorry, the cheque was 10 Aug 2026.', CTX);

    expect(state.status).toBe('gathering');
    expect(state.refusal).toBeNull();
    expect(state.questions.length).toBeGreaterThan(0); // asking resumed
    const field = state.factSheet.flatMap((s) => s.fields).find((f) => f.key === 'cheque_date');
    expect(field?.value).toBe('2026-08-10');
  });

  it('a direct edit lands as stated and re-evaluates through the same loop', async () => {
    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'recipient_name', code: 'required', message: 'x' }] });
    let state = await intakeService.start(DOC, 'Hi.', CTX);

    // Edit the recipient directly (§10). The engine now generates.
    engineQueue.push({ kind: 'generated' });
    state = await intakeService.edit(state.matterId, DOC, { recipient_name: 'Sandeep Verma' }, CTX);

    const field = state.factSheet.flatMap((s) => s.fields).find((f) => f.key === 'recipient_name');
    expect(field?.value).toBe('Sandeep Verma');
    expect(field?.meta?.confidence).toBe('stated');
    expect(field?.meta?.via).toBe('direct-edit'); // never 'inferred'
    expect(state.status).toBe('generated');
    expect(state.draft?.blocks[0]?.text).toBe('DRAFT');
  });

  // drafting-efficiency: typing in the live panel re-drafts on the engine only.
  it('a live edit with compose:false re-drafts without compose', async () => {
    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'generated' });
    const state = await intakeService.start(DOC, 'Everything is here.', CTX);
    expect(composeCalls).toHaveLength(1);

    engineQueue.push({ kind: 'generated' });
    const live = await intakeService.edit(state.matterId, DOC, { recipient_name: 'Sandeep Verma' }, CTX,
      { draftNow: true, compose: false });
    expect(live.status).toBe('generated');
    expect(live.draftedBy).toBe('engine');
    expect(composeCalls).toHaveLength(1); // no compose on the typing path

    engineQueue.push({ kind: 'generated' });
    await intakeService.edit(state.matterId, DOC, { recipient_name: 'Sandeep Verma' }, CTX, { draftNow: true });
    expect(composeCalls).toHaveLength(2); // "Update document" still composes
  });

  it('a live edit with compose:false never falls back to the AI draft when blocked', async () => {
    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'place', code: 'required', message: 'x' }] });
    const state = await intakeService.start(DOC, 'A cheque bounced.', CTX);
    const refusal = {
      code: 's138_notice_cheque_presented_after_validity', severity: 'HARD',
      reason: 'The cheque was presented after its validity.', computation: null,
      pipeline: 's138_notice', spec: '2.2', fields_implicated: ['cheque_date'], remedy_hint: 'none',
    };
    // Draft-now may retry the engine after a refusal; every try still refuses.
    for (let i = 0; i < 4; i += 1) engineQueue.push({ kind: 'refused', refusal });
    (env as { ANTHROPIC_API_KEY: string }).ANTHROPIC_API_KEY = 'test-key';
    claudeQueue.push('LEGAL NOTICE\n\nA model draft that must not be used.');
    try {
      const live = await intakeService.edit(state.matterId, DOC, { cheque_date: '2020-01-01' }, CTX,
        { draftNow: true, compose: false });
      expect(live.status).toBe('refused');
      expect(live.draftedBy).not.toBe('ai');
      expect(claudeQueue).toHaveLength(1); // Claude never called
    } finally {
      claudeQueue.length = 0; // not reset in beforeEach
    }
  });

  it('downgrades a field to direct entry after the ask limit (2)', async () => {
    // Same missing field, asked repeatedly; the advocate never fills it.
    for (let i = 0; i < 3; i += 1) {
      extractQueue.push(patch([]));
      engineQueue.push({ kind: 'issues', issues: [{ field: 'place', code: 'required', message: 'x' }] });
    }
    let state = await intakeService.start(DOC, 'Start.', CTX);
    expect(state.directEntryFields).not.toContain('place'); // asked 1st time
    state = await intakeService.reply(state.matterId, DOC, 'no idea', CTX); // asked 2nd time
    state = await intakeService.reply(state.matterId, DOC, 'still not sure', CTX); // limit hit
    expect(state.directEntryFields).toContain('place');
  });

  it('generates and hands off the draft as the only success exit', async () => {
    extractQueue.push(patch([{ key: 'sender_name', value: 'Mehta', confidence: 'stated', source: 'x' }]));
    engineQueue.push({ kind: 'generated' });
    const state = await intakeService.start(DOC, 'Everything is here.', CTX);
    expect(state.status).toBe('generated');
    expect(state.draft).not.toBeNull();
    expect(state.refusal).toBeNull();
    expect(state.questions).toHaveLength(0);
  });
});

describe('intake COMPOSE — enrich the ALREADY-VALIDATED draft, never before', () => {
  it('is called ONLY when the engine returns generated (never on issues/refusal)', async () => {
    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'recipient_name', code: 'required', message: 'x' }] });
    await intakeService.start(DOC, 'Hi.', CTX);
    expect(composeCalls).toHaveLength(0); // 422 — compose must NOT fire

    extractQueue.push(patch([{ key: 'cheque_date', value: '2020-01-01', confidence: 'stated', source: 'x' }]));
    engineQueue.push({
      kind: 'refused',
      refusal: {
        code: 's138_notice_cheque_presented_after_validity', severity: 'HARD',
        reason: 'stale', computation: null, pipeline: 's138_notice', spec: '2.2',
        fields_implicated: ['cheque_date'], remedy_hint: 'none',
      },
    });
    await intakeService.start(DOC, 'An old cheque.', CTX);
    expect(composeCalls).toHaveLength(0); // refusal — compose must NOT fire

    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'generated' });
    await intakeService.start(DOC, 'Everything is here.', CTX);
    expect(composeCalls).toHaveLength(1); // generated — compose fires exactly once
  });

  it('receives the engine blocks + LABELLED validated facts — never the raw message', async () => {
    extractQueue.push(patch([{ key: 'sender_name', value: 'Mehta Enterprises', confidence: 'stated', source: 'x' }]));
    engineQueue.push({ kind: 'generated' });
    await intakeService.start(DOC, 'SECRET RAW PROSE the model must never see verbatim as a fact source', CTX);

    expect(composeCalls).toHaveLength(1);
    const call = composeCalls[0]!;
    // The engine's own block text is what's passed (from the mocked draft: "DRAFT").
    expect(call.engineBlocks).toEqual([{ key: 'body', text: 'DRAFT' }]);
    // Facts are keyed by LABEL and contain the validated value.
    expect(Object.values(call.facts)).toContain('Mehta Enterprises');
    // The raw advocate sentence is NOT smuggled into the facts map.
    expect(JSON.stringify(call.facts)).not.toContain('SECRET RAW PROSE');
  });

  it('a composed:true result REPLACES the draft blocks shown to the advocate', async () => {
    composeQueue.push({ composed: true, blocks: [{ key: 'composed_0', text: 'Enriched advocate-style prose.' }] });
    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'generated' });
    const state = await intakeService.start(DOC, 'Everything is here.', CTX);
    expect(state.draft?.blocks).toEqual([{ key: 'composed_0', text: 'Enriched advocate-style prose.' }]);
  });

  it('a composed:false result (VERIFY rejected / compose failed) keeps the engine plain draft', async () => {
    composeQueue.push({ composed: false, blocks: [{ key: 'body', text: 'DRAFT' }] });
    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'generated' });
    const state = await intakeService.start(DOC, 'Everything is here.', CTX);
    // Falls back to exactly the engine's own block — never a partially-composed
    // or unverified text reaches the advocate.
    expect(state.draft?.blocks).toEqual([{ key: 'body', text: 'DRAFT' }]);
  });

  it('tells the advocate it is the plain draft, and why', async () => {
    composeQueue.push({ composed: false, blocks: [{ key: 'body', text: 'DRAFT' }], rejectedReason: 'dropped from the skeleton: s.317(2)' });
    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'generated' });
    const state = await intakeService.start(DOC, 'Everything is here.', CTX);
    expect(state.draft?.composeStatus).toBe('skeleton');
    expect(state.draft?.composeNotice).toContain('s.317(2)');
  });
});

describe('intake loop — attachments as a FREE, local extraction source', () => {
  async function startConversation() {
    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'recipient_name', code: 'required', message: 'x' }] });
    return intakeService.start(DOC, 'Starting a s.138 matter.', CTX);
  }

  it('reads an IMAGE via LOCAL OCR, then the LLM extractor; values land inferred (attachment provenance)', async () => {
    let state = await startConversation();

    // The image goes to local OCR (returns text), then — because an attached document is
    // a substantial read and a provider is configured — the LLM extractor maps that text
    // to fields (see intake.service attach(): attachments prefer the LLM extractor
    // independent of INTAKE_DETERMINISTIC). The service re-marks the values inferred.
    ocrQueue.push({ ok: true, text: 'cheque no 000456789 amount Rs. 475000' });
    extractQueue.push(patch([
      { key: 'cheque_amount', value: '475000', confidence: 'stated', source: 'Rs. 475000' },
      { key: 'cheque_no', value: '000456789', confidence: 'stated', source: 'cheque no 000456789' },
    ]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'notice_date', code: 'required', message: 'x' }] });

    state = await intakeService.attach(
      state.matterId, DOC,
      [{ fileName: 'cheque.jpg', mime: 'image/jpeg', dataBase64: Buffer.from('fake').toString('base64') }],
      '', CTX,
    );

    // The image went to LOCAL OCR (one call); its text reached the LLM extractor.
    expect(ocrCalls).toHaveLength(1);
    expect(extractCalls.at(-1)).toContain('cheque no 000456789');

    const amount = state.factSheet.flatMap((s) => s.fields).find((f) => f.key === 'cheque_amount');
    expect(amount?.value).toBe('475000');
    expect(amount?.meta?.confidence).toBe('inferred');   // re-marked: read off a document
    expect(amount?.meta?.via).toBe('attachment');        // provenance recorded
    expect(amount?.meta?.derivation).toContain('cheque.jpg');
    // The attachment is recorded as an advocate turn naming the file.
    const attachTurn = state.transcript.find((t) => t.role === 'advocate' && t.text.includes('cheque.jpg'));
    expect(attachTurn).toBeTruthy();
    // Still gathering — an attachment fills fields, it does not end the loop.
    expect(state.status).toBe('gathering');
  });

  it('reads a PDF via LOCAL text extraction, then the LLM extractor', async () => {
    let state = await startConversation();

    textExtractQueue.push({ ok: true, text: 'memo received on 20-03-2026' });
    extractQueue.push(patch([
      { key: 'memo_received_date', value: '2026-03-20', confidence: 'stated', source: '20-03-2026' },
    ]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'notice_date', code: 'required', message: 'x' }] });

    state = await intakeService.attach(
      state.matterId, DOC,
      [{ fileName: 'memo.pdf', mime: 'application/pdf', dataBase64: Buffer.from('%PDF-fake').toString('base64') }],
      '', CTX,
    );

    // A PDF is NOT an image → no OCR call; text extraction fed the LLM reader.
    expect(ocrCalls).toHaveLength(0);
    expect(extractCalls.at(-1)).toContain('20-03-2026');
    const memo = state.factSheet.flatMap((s) => s.fields).find((f) => f.key === 'memo_received_date');
    expect(memo?.value).toBe('2026-03-20');
    expect(memo?.meta?.via).toBe('attachment');
  });

  it('an attachment can trigger a REFUSAL just like typed facts (hard-stops still apply)', async () => {
    let state = await startConversation();

    // OCR reads a stale cheque date; the engine refuses. The attachment FILLED a
    // field but did NOT bypass the hard-stop.
    ocrQueue.push({ ok: true, text: 'cheque dated 01-01-2020' });
    detQueue.push(patch([
      { key: 'cheque_date', value: '2020-01-01', confidence: 'stated', source: '01-01-2020' },
    ]));
    engineQueue.push({
      kind: 'refused',
      refusal: {
        code: 's138_notice_cheque_presented_after_validity', severity: 'HARD',
        reason: 'The cheque was presented after its validity.', computation: null,
        pipeline: 's138_notice', spec: '2.2', fields_implicated: ['cheque_date'], remedy_hint: 'none',
      },
    });

    state = await intakeService.attach(
      state.matterId, DOC,
      [{ fileName: 'old-cheque.jpg', mime: 'image/jpeg', dataBase64: Buffer.from('x').toString('base64') }],
      '', CTX,
    );

    expect(state.status).toBe('refused');
    expect(state.refusal?.code).toBe('s138_notice_cheque_presented_after_validity');
  });

  it('an unreadable file is carried as an annexure note, not read', async () => {
    let state = await startConversation();

    // A .zip: not an image, text extraction fails → annexure note, deterministic
    // extractor never called (no readable text).
    textExtractQueue.push({ ok: false, error: 'unsupported' });
    engineQueue.push({ kind: 'issues', issues: [{ field: 'notice_date', code: 'required', message: 'x' }] });

    state = await intakeService.attach(
      state.matterId, DOC,
      [{ fileName: 'evidence.zip', mime: 'application/zip', dataBase64: Buffer.from('PK').toString('base64') }],
      '', CTX,
    );

    expect(detCalls).toHaveLength(0);
    const note = state.transcript.find((t) => t.role === 'assistant' && t.text.includes('annexure') && t.text.includes('evidence.zip'));
    expect(note).toBeTruthy();
  });

  it('an image OCR that reads nothing falls back to an annexure note', async () => {
    let state = await startConversation();
    ocrQueue.push({ ok: false, error: 'no text recognised' });
    engineQueue.push({ kind: 'issues', issues: [{ field: 'notice_date', code: 'required', message: 'x' }] });

    state = await intakeService.attach(
      state.matterId, DOC,
      [{ fileName: 'blurry.jpg', mime: 'image/jpeg', dataBase64: Buffer.from('x').toString('base64') }],
      '', CTX,
    );

    // OCR was attempted but yielded nothing → no deterministic call, annexure note.
    expect(ocrCalls).toHaveLength(1);
    expect(detCalls).toHaveLength(0);
    const note = state.transcript.find((t) => t.role === 'assistant' && t.text.includes('annexure') && t.text.includes('blurry.jpg'));
    expect(note).toBeTruthy();
  });

  it('AUTO-LISTS every attached file in extra_documents (complaint LIST OF DOCUMENTS)', async () => {
    const COMPLAINT = 'Complaint u/s 138 NI Act';
    // Start a complaint conversation (passthrough doc; sections derived from the
    // mocked docTypes describe, which declares extra_documents).
    engineQueue.push({ kind: 'issues', issues: [{ field: 'complainant_name', code: 'required', message: 'x' }] });
    let state = await intakeService.start(COMPLAINT, 'Cheque bounced.', CTX);

    // Attach a READABLE witness statement (image → OCR) AND an UNREADABLE annexure
    // (.zip). Both must be added to the document list regardless of readability.
    ocrQueue.push({ ok: true, text: 'witness statement of S. Kannan' });
    extractQueue.push(patch([])); // no fields extracted; we care about the auto-list
    textExtractQueue.push({ ok: false, error: 'unsupported' });
    engineQueue.push({ kind: 'issues', issues: [{ field: 'complainant_name', code: 'required', message: 'x' }] });

    state = await intakeService.attach(
      state.matterId, COMPLAINT,
      [
        { fileName: 'witness-statement.jpg', mime: 'image/jpeg', dataBase64: Buffer.from('a').toString('base64') },
        { fileName: 'exhibits.zip', mime: 'application/zip', dataBase64: Buffer.from('PK').toString('base64') },
      ],
      '', CTX,
    );

    const docsField = state.factSheet.flatMap((s) => s.fields).find((f) => f.key === 'extra_documents');
    expect(docsField).toBeTruthy();
    const listed = String(docsField?.value ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    expect(listed).toContain('witness-statement.jpg');
    expect(listed).toContain('exhibits.zip');
    expect(docsField?.meta?.via).toBe('attachment');
  });

  it('does not DOUBLE-list a file re-attached across two turns', async () => {
    const COMPLAINT = 'Complaint u/s 138 NI Act';
    engineQueue.push({ kind: 'issues', issues: [{ field: 'complainant_name', code: 'required', message: 'x' }] });
    let state = await intakeService.start(COMPLAINT, 'Cheque bounced.', CTX);

    // First attach.
    ocrQueue.push({ ok: true, text: 'witness statement' });
    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'complainant_name', code: 'required', message: 'x' }] });
    state = await intakeService.attach(
      state.matterId, COMPLAINT,
      [{ fileName: 'witness.jpg', mime: 'image/jpeg', dataBase64: Buffer.from('a').toString('base64') }],
      '', CTX,
    );

    // Re-attach the SAME file name on a second turn.
    ocrQueue.push({ ok: true, text: 'witness statement again' });
    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'complainant_name', code: 'required', message: 'x' }] });
    state = await intakeService.attach(
      state.matterId, COMPLAINT,
      [{ fileName: 'witness.jpg', mime: 'image/jpeg', dataBase64: Buffer.from('b').toString('base64') }],
      '', CTX,
    );

    const docsField = state.factSheet.flatMap((s) => s.fields).find((f) => f.key === 'extra_documents');
    const listed = String(docsField?.value ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    expect(listed.filter((n) => n === 'witness.jpg')).toHaveLength(1); // exactly one
  });

  it('SEEDS Tamil-Nadu s.138 practice defaults on a fresh complaint (itemise & twice-amount = Yes)', async () => {
    const COMPLAINT = 'Complaint u/s 138 NI Act';
    engineQueue.push({ kind: 'issues', issues: [{ field: 'complainant_name', code: 'required', message: 'x' }] });
    const state = await intakeService.start(COMPLAINT, 'Cheque bounced; want to file the complaint.', CTX);

    const val = (key: string) =>
      state.factSheet.flatMap((s) => s.fields).find((f) => f.key === key)?.value;
    // These are pre-set before the advocate answers anything, so the generated
    // complaint follows TN practice unless the advocate changes them.
    expect(val('itemise_documents')).toBe('Yes');
    expect(val('prayer_twice_amount')).toBe('Yes');
    expect(val('is_payee')).toBe('Yes');
    expect(val('payee_bank_branch_in_jurisdiction')).toBe('Yes');
  });

  it('startAuto routes a "complaint under 138" brief to the COMPLAINT and seeds its defaults', async () => {
    // Deterministic keyword path: "138 ... complaint/file" -> Complaint (not Notice).
    classifyQueue.push({ label: null, confidence: 'low' });
    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'complainant_name', code: 'required', message: 'x' }] });

    const state = await intakeService.startAuto(
      'Please draft a complaint under section 138 to file in court; the cheque was dishonoured.',
      CTX,
    );

    expect(state.docLabel).toBe('Complaint u/s 138 NI Act');
    const twice = state.factSheet.flatMap((s) => s.fields).find((f) => f.key === 'prayer_twice_amount');
    expect(twice?.value).toBe('Yes');
  });

  it('surfaces the FULL document text on state.sourceText (for a "Draft now")', async () => {
    let state = await startConversation();

    // OCR reads a rich cheque; only some of it maps to fields, but the WHOLE text
    // must be preserved on state.sourceText so a one-shot draft can use all of it.
    const fullText = 'PAYEE Mehta Enterprises DRAWER Verma Traders '
      + 'cheque no 000456789 amount Rs. 475000 dated 10-08-2026 '
      + 'drawn on Karur Vysya Bank Godown Street Branch return memo funds insufficient';
    ocrQueue.push({ ok: true, text: fullText });
    detQueue.push(patch([
      { key: 'cheque_amount', value: '475000', confidence: 'stated', source: 'Rs. 475000' },
    ]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'notice_date', code: 'required', message: 'x' }] });

    state = await intakeService.attach(
      state.matterId, DOC,
      [{ fileName: 'cheque.jpg', mime: 'image/jpeg', dataBase64: Buffer.from('x').toString('base64') }],
      '', CTX,
    );

    // The whole OCR'd content is on sourceText — not just the one parsed field.
    expect(state.sourceText).toBeTruthy();
    expect(state.sourceText).toContain('Mehta Enterprises');
    expect(state.sourceText).toContain('Verma Traders');
    expect(state.sourceText).toContain('Karur Vysya Bank');
    expect(state.sourceText).toContain('000456789');
  });

  it('accumulates sourceText across successive attachments', async () => {
    let state = await startConversation();

    ocrQueue.push({ ok: true, text: 'first document payee Mehta' });
    detQueue.push(patch([]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'notice_date', code: 'required', message: 'x' }] });
    state = await intakeService.attach(
      state.matterId, DOC,
      [{ fileName: 'a.jpg', mime: 'image/jpeg', dataBase64: Buffer.from('x').toString('base64') }],
      '', CTX,
    );
    expect(state.sourceText).toContain('first document payee Mehta');

    ocrQueue.push({ ok: true, text: 'second document drawer Verma' });
    detQueue.push(patch([]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'notice_date', code: 'required', message: 'x' }] });
    state = await intakeService.attach(
      state.matterId, DOC,
      [{ fileName: 'b.jpg', mime: 'image/jpeg', dataBase64: Buffer.from('y').toString('base64') }],
      '', CTX,
    );
    // BOTH documents' text is retained.
    expect(state.sourceText).toContain('first document payee Mehta');
    expect(state.sourceText).toContain('second document drawer Verma');
  });

  it('a caption typed with the attachment is recorded on the advocate turn', async () => {
    let state = await startConversation();
    ocrQueue.push({ ok: true, text: 'some text' });
    detQueue.push(patch([]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'notice_date', code: 'required', message: 'x' }] });

    state = await intakeService.attach(
      state.matterId, DOC,
      [{ fileName: 'cheque.jpg', mime: 'image/jpeg', dataBase64: Buffer.from('x').toString('base64') }],
      'This is the bounced cheque.', CTX,
    );
    const turn = state.transcript.find((t) => t.role === 'advocate' && t.text.includes('This is the bounced cheque.'));
    expect(turn).toBeTruthy();
  });
});

describe('intake DRAFT NOW — fill gaps with placeholders, never fabricate, honour hard-stops', () => {
  it('drafts immediately, filling missing required fields with placeholders', async () => {
    // Turn 1: a paste fills some fields; the engine still wants more.
    extractQueue.push(patch([{ key: 'sender_name', value: 'Mehta', confidence: 'stated', source: 'x' }]));
    engineQueue.push({ kind: 'issues', issues: [
      { field: 'recipient_name', code: 'required', message: 'x' },
      { field: 'place', code: 'required', message: 'x' },
    ] });
    const state = await intakeService.start(DOC, 'Cheque matter for Mehta.', CTX);
    expect(state.status).toBe('gathering');

    // Draft now: the engine 422s once more (the missing fields), then GENERATES on
    // the placeholder-filled retry. Two engine calls: the initial 422, then success.
    engineQueue.push({ kind: 'issues', issues: [
      { field: 'recipient_name', code: 'required', message: 'x' },
      { field: 'place', code: 'required', message: 'x' },
    ] });
    engineQueue.push({ kind: 'generated' });
    const drafted = await intakeService.draftNow(state.matterId, DOC, CTX);

    expect(drafted.status).toBe('generated');
    expect(drafted.draft?.blocks[0]?.text).toBe('DRAFT');
    // The placeholder-filled retry carried bracketed markers for the missing
    // required fields — NEVER fabricated values.
    const retryFields = draftCalls[draftCalls.length - 1]!;
    const values = JSON.stringify(retryFields);
    expect(values).toContain('['); // at least one bracketed placeholder was sent
  });

  // DRAFT FIRST, ALWAYS (advocate's rule): a hard-stop no longer blocks "Draft
  // now" — the same document is drafted from the facts on record and the
  // engine's finding is surfaced as a Before-filing note (never hidden).
  it('a hard-stop during draft-now still produces a draft, with the finding as a note', async () => {
    extractQueue.push(patch([{ key: 'cheque_date', value: '2020-01-01', confidence: 'stated', source: 'old' }]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'place', code: 'required', message: 'x' }] });
    const state = await intakeService.start(DOC, 'An old 2020 cheque.', CTX);

    // Draft now: 422 for place, then the placeholder retry REFUSES (stale cheque).
    engineQueue.push({ kind: 'issues', issues: [{ field: 'place', code: 'required', message: 'x' }] });
    engineQueue.push({ kind: 'refused', refusal: {
      code: 's138_notice_cheque_presented_after_validity', severity: 'HARD',
      reason: 'The cheque was presented after its validity.', computation: null,
      pipeline: 's138_notice', spec: '2.2', fields_implicated: ['cheque_date'], remedy_hint: 'none',
    } });
    (env as { ANTHROPIC_API_KEY: string }).ANTHROPIC_API_KEY = 'test-key';
    claudeQueue.push(['LEGAL NOTICE', 'To [drawer name to be provided]', '1. The cheque dated 01.01.2020 was dishonoured.', 'Yours faithfully'].join('\n\n'));
    const drafted = await intakeService.draftNow(state.matterId, DOC, CTX);

    expect(drafted.status).toBe('generated');
    expect(drafted.draftedBy).toBe('ai');
    expect(drafted.draft?.blocks.length).toBeGreaterThan(2);
    expect(drafted.draftNotes?.[0]).toContain('presented after its validity');
  });

  it('a first-call refusal on a field the gap pre-fill supplies re-drafts on the engine (r7 anticipatory bail)', async () => {
    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'place', code: 'required', message: 'x' }] });
    const state = await intakeService.start(DOC, 'A cheque bounced.', CTX);
    engineQueue.push({ kind: 'refused', refusal: {
      code: 'x_place_missing', severity: 'HARD', reason: 'place is needed.', computation: null,
      pipeline: 's138_notice', spec: '1', fields_implicated: ['place'], remedy_hint: 'none',
    } });
    engineQueue.push({ kind: 'generated' });
    const drafted = await intakeService.draftNow(state.matterId, DOC, CTX);
    expect(drafted.status).toBe('generated');
    expect(drafted.draftedBy).not.toBe('ai');
    expect(String(draftCalls.at(-1)?.place ?? '')).not.toBe('');
  });

  it('if the draft-first fallback is unavailable, the hard-stop is returned as before', async () => {
    extractQueue.push(patch([{ key: 'cheque_date', value: '2020-01-01', confidence: 'stated', source: 'old' }]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'place', code: 'required', message: 'x' }] });
    const state = await intakeService.start(DOC, 'An old 2020 cheque.', CTX);
    engineQueue.push({ kind: 'issues', issues: [{ field: 'place', code: 'required', message: 'x' }] });
    engineQueue.push({ kind: 'refused', refusal: {
      code: 's138_notice_cheque_presented_after_validity', severity: 'HARD',
      reason: 'The cheque was presented after its validity.', computation: null,
      pipeline: 's138_notice', spec: '2.2', fields_implicated: ['cheque_date'], remedy_hint: 'none',
    } });
    (env as { ANTHROPIC_API_KEY: string }).ANTHROPIC_API_KEY = 'test-key';
    claudeQueue.push(new Error('model down'));
    const drafted = await intakeService.draftNow(state.matterId, DOC, CTX);
    expect(drafted.status).toBe('refused');
    expect(drafted.draft).toBeNull();
  });
});

describe('draft-now date fill — "as on" is the drafting date, not a gap', () => {
  it('fills a missing as_on with today and does NOT mark it as a placeholder date', async () => {
    const { fillMissingDate } = await import('../intake.service');
    const synthetic = new Set<string>();
    const today = new Date().toISOString().slice(0, 10);
    // Base stand-in = the arrest date on record; using it for as_on computed "1 days".
    expect(fillMissingDate('as_on', '2026-10-10', { custody_since: '2026-10-10' }, synthetic)).toBe(today);
    expect(synthetic.size).toBe(0);
  });

  it("dates a notice or petition today, but never a reply with the opponent's notice date", async () => {
    const { fillMissingDate } = await import('../intake.service');
    const today = new Date().toISOString().slice(0, 10);
    const synthetic = new Set<string>();
    // r6: an s.138 notice came out dated with the cheque date (the stand-in).
    expect(fillMissingDate('notice_date', '2026-09-01', { cheque_date: '2026-09-01' }, synthetic, 's138_notice')).toBe(today);
    expect(fillMissingDate('petition_date', '2026-09-01', {}, synthetic, 'quash_petition')).toBe(today);
    expect(synthetic.size).toBe(0);
    // In a reply (or an s.138 complaint) notice_date is a past event: still a marked stand-in.
    expect(fillMissingDate('notice_date', '2026-09-01', {}, synthetic, 's138_complaint')).toBe('2026-09-01');
    expect([...synthetic]).toEqual(['2026-09-01']);
  });

  it('dates a mutual-consent motion today and gives an s.106 quit date clear 15 days', async () => {
    const { fillMissingDate } = await import('../intake.service');
    const today = new Date().toISOString().slice(0, 10);
    const synthetic = new Set<string>();
    // r7: first_motion_date took the marriage date, so "one year apart" failed.
    expect(fillMissingDate('first_motion_date', '2017-08-25', {}, synthetic, 'divorce_mutual_first')).toBe(today);
    // r7: the quit date took the notice date (0 days' notice: an invalid s.106 notice).
    expect(fillMissingDate('quit_date', '2026-11-05', { notice_date: '2026-11-05' }, synthetic, 's106_notice')).toBe('2026-11-21');
    expect(synthetic.size).toBe(0);
  });

  it('MACT: a claimed total that differs from the computation is dropped for the computed one, with a note', async () => {
    const { dropMismatchedClaim } = await import('../intake.service');
    const refusal = {
      code: 'mact_claim_claimed_total_mismatch', severity: 'hard', reason: 'x', pipeline: 'mact_claim', spec: '',
      computation: 'claimed=8500000; computed=8710000', fields_implicated: ['claimed_total'], remedy_hint: '',
    };
    const form: Record<string, string> = { claimed_total: '8500000', victim_age: '34' };
    expect(dropMismatchedClaim(refusal, form)).toContain('Rs. 87,10,000');
    expect(form).toEqual({ claimed_total: '8710000', victim_age: '34' });
    // Already the computed figure: nothing to do (no loop).
    expect(dropMismatchedClaim(refusal, form)).toBeNull();
    // Any other refusal leaves the form alone.
    expect(dropMismatchedClaim({ ...refusal, code: 'other' }, { claimed_total: '1' })).toBeNull();
    // A stand-in 0 (claim not extracted) also takes the computed figure.
    const blank: Record<string, string> = { claimed_total: '0' };
    expect(dropMismatchedClaim(refusal, blank)).toContain('Rs. 87,10,000');
    expect(blank.claimed_total).toBe('8710000');
  });

  it('derives dates the record fixes, and never uses a real date as a stand-in (r8)', async () => {
    const { fillMissingDate, markSyntheticDates } = await import('../intake.service');
    const today = new Date().toISOString().slice(0, 10);
    const synthetic = new Set<string>();
    // s.138 complaint: the notice is dated the day it was sent, not the cheque date.
    expect(fillMissingDate('notice_date', '2026-08-10', { notice_dispatch_date: '2026-09-30' }, synthetic, 's138_complaint')).toBe('2026-09-30');
    // Month-to-month ejectment: lease ends on termination; cause of action the next day.
    const ej = { tenancy_end_date: '2026-08-23', filing_date: today };
    expect(fillMissingDate('lease_expiry_date', today, ej, synthetic, 'ejectment')).toBe('2026-08-23');
    expect(fillMissingDate('cause_of_action_date', today, ej, synthetic, 'ejectment')).toBe('2026-08-24');
    expect(synthetic.size).toBe(0);
    // A stand-in equal to today's filing date steps back, so marking it can't blank the real "Date:".
    const sv = fillMissingDate('cause_of_action_date', today, { filing_date: today }, synthetic, 'plaint');
    expect(sv).not.toBe(today);
    const [y, m, d] = sv.split('-');
    const [ty, tm, td] = today.split('-');
    const out = markSyntheticDates({ outcome: 'generated', blocks: [
      { key: 'a', text: `The cause of action arose on ${d}.${m}.${y}.` },
      { key: 'b', text: `Date: ${td}.${tm}.${ty}` },
    ] } as never, synthetic);
    expect(out.blocks[0]!.text).toContain('[DATE TO BE CONFIRMED]');
    expect(out.blocks[1]!.text).toBe(`Date: ${td}.${tm}.${ty}`);
  });

  it('puts an applied stand-in before its ready date, and still marks it (r11)', async () => {
    const { fillMissingDate } = await import('../intake.service');
    const synthetic = new Set<string>();
    expect(fillMissingDate('copy_applied_date', '2026-11-07', { copy_ready_date: '2026-10-05' }, synthetic, 'civil_revision')).toBe('2026-10-04');
    expect([...synthetic]).toEqual(['2026-10-04']);
  });

  it('keeps the marked stand-in for any other missing date', async () => {
    const { fillMissingDate } = await import('../intake.service');
    const synthetic = new Set<string>();
    expect(fillMissingDate('offence_date', '2026-10-10', {}, synthetic)).toBe('2026-10-10');
    expect([...synthetic]).toEqual(['2026-10-10']);
  });
});

describe('intake — a matter opens only for its own firm (audit 2026-11-07)', () => {
  it('another firm, or another solo user, cannot load, edit or draft it by id', async () => {
    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'place', code: 'required', message: 'x' }] });
    const state = await intakeService.start(DOC, 'A cheque bounced.', CTX);
    const other = { firmId: 'firm2', userId: 'user2' };
    await expect(intakeService.load(state.matterId, DOC, other)).rejects.toThrow(/no intake/);
    await expect(intakeService.edit(state.matterId, DOC, { place: 'Chennai' }, other)).rejects.toThrow(/no intake/);
    await expect(intakeService.draftNow(state.matterId, DOC, other)).rejects.toThrow(/no intake/);
    await expect(intakeService.load(state.matterId, DOC, { firmId: null, userId: 'user2' })).rejects.toThrow(/no intake/);
    // ...nor add a version to it (POST /engine/ensure-matter writes through revise).
    await expect(factSheetService.revise(state.matterId, { place: 'X' }, other)).rejects.toThrow(/no fact sheet/);
    // A teammate in the same firm still can.
    engineQueue.push({ kind: 'issues', issues: [{ field: 'place', code: 'required', message: 'x' }] });
    await expect(intakeService.load(state.matterId, DOC, { firmId: 'firm1', userId: 'user3' })).resolves.toBeTruthy();
  });
});

vi.mock('../open-draft.service', () => ({
  OpenDraftRefused: class extends Error {},
  composeOpenDraft: vi.fn(async () => ({ title: 'Family Settlement Deed', kind: 'deed', blueprint: null, lines: ['THIS DEED', 'WITNESSETH'], notes: ['check'] })),
}));

describe('intake loop — auto-detect the format (startAuto)', () => {
  it('classifies the opening brief and runs intake for the detected label', async () => {
    classifyQueue.push({ label: 'Notice u/s 138 NI Act', confidence: 'high' });
    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'recipient_name', code: 'required', message: 'x' }] });

    const state = await intakeService.startAuto('A cheque for 5 lakh bounced last week.', CTX);

    expect(state.detectedDocLabel).toBe('Notice u/s 138 NI Act');
    expect(state.detectionConfidence).toBe('high');
    expect(state.docLabel).toBe('Notice u/s 138 NI Act');
    expect(state.status).toBe('gathering');
  });

  it('falls back to a KEYWORD guess when the classifier returns nothing', async () => {
    classifyQueue.push({ label: null, confidence: 'low' });
    extractQueue.push(patch([]));
    engineQueue.push({ kind: 'issues', issues: [{ field: 'recipient_name', code: 'required', message: 'x' }] });

    // "cheque ... dishonoured" keyword-maps to the s.138 notice.
    const state = await intakeService.startAuto('The cheque was dishonoured for insufficient funds.', CTX);
    expect(state.docLabel).toBe('Notice u/s 138 NI Act');
    expect(state.detectionConfidence).toBe('low');
  });

  it('never substitutes a format when the classifier says the document is not listed', async () => {
    classifyQueue.push({ label: null, confidence: 'low', notListed: 'Family Settlement Deed' } as never);
    const state = await intakeService.startAuto('The two brothers want the sale of the land and the gift recorded by agreement.', CTX);
    expect(state.docLabel).toBe('Family Settlement Deed (open draft)');
    expect(state.draftedBy).toBe('open');
    expect(state.status).toBe('generated');
    expect(state.draftNotes).toEqual(['check']);
    expect(state.draft!.blocks.map((b) => b.text)).toEqual(['THIS DEED', 'WITNESSETH']);
  });

  it('reopens an open draft with its label and notes, without another model call', async () => {
    classifyQueue.push({ label: null, confidence: 'low', notListed: 'Family Settlement Deed' } as never);
    const first = await intakeService.startAuto('The brothers want the family property recorded.', CTX);
    const { composeOpenDraft } = await import('../open-draft.service');
    const calls = vi.mocked(composeOpenDraft).mock.calls.length;
    const again = await intakeService.load(first.matterId, first.docLabel, CTX);
    expect(again).toMatchObject({ draftedBy: 'open', status: 'generated', draftNotes: ['check'] });
    expect(vi.mocked(composeOpenDraft).mock.calls.length).toBe(calls);
  });

  it('throws IntakeError when neither the classifier nor keywords can decide', async () => {
    classifyQueue.push({ label: null, confidence: 'low' });
    await expect(
      intakeService.startAuto('I need some assistance today.', CTX),
    ).rejects.toThrow(/could not determine the document type/i);
  });
});

describe('intake startAuto — DETERMINISTIC mode makes no LLM classify call', () => {
  it('classifies by keyword only when intakeDeterministic is on (fast path)', async () => {
    (env as { intakeDeterministic: boolean }).intakeDeterministic = true;
    try {
      // No classifyQueue entry pushed; if the LLM classifier were called the mock
      // would still run — we assert it was NOT called.
      engineQueue.push({ kind: 'issues', issues: [{ field: 'recipient_name', code: 'required', message: 'x' }] });
      const state = await intakeService.startAuto('the cheque was dishonoured for insufficient funds', CTX);
      expect(classifyCalls).toHaveLength(0);                 // LLM classifier NOT called
      expect(state.docLabel).toBe('Notice u/s 138 NI Act');  // keyword classifier picked it
      expect(state.detectedDocLabel).toBe('Notice u/s 138 NI Act');
    } finally {
      (env as { intakeDeterministic: boolean }).intakeDeterministic = false;
    }
  });
});

describe('intake extraction — HYBRID: free rules for short answers, LLM for a document paste', () => {
  it('a short typed answer uses the FREE rule extractor, not the LLM', async () => {
    (env as { intakeDeterministic: boolean }).intakeDeterministic = true;
    try {
      detQueue.push(patch([]));
      engineQueue.push({ kind: 'issues', issues: [{ field: 'recipient_name', code: 'required', message: 'x' }] });
      await intakeService.start(DOC, 'the payee is Mehta', CTX);
      expect(detCalls.length).toBe(1);       // deterministic extractor ran (free)
    } finally {
      (env as { intakeDeterministic: boolean }).intakeDeterministic = false;
    }
  });

  it('a SUBSTANTIAL document paste escalates to the LLM (to read buried names)', async () => {
    (env as { intakeDeterministic: boolean }).intakeDeterministic = true;
    try {
      // A dense agreement — long, multi-fact. Regex can't parse the buried party
      // names, so the paid LLM path reads it (one call, on a genuine paste only).
      const doc = 'CHEQUE PRESENTATION DEFERMENT AGREEMENT made on 5th May 2026 at Chennai. '
        + 'BETWEEN THOORIGAI PRINTS, Proprietor: Ambeth Arivukarasan, PAN BKKPA0600B, hereinafter '
        + 'referred to as the Vendor/Payee AND VENKI PUBLICATIONS, Proprietor: R. Venkatesh Bhat, '
        + 'hereinafter referred to as the Customer/Drawer. The Customer issued Cheque No. 000105 '
        + 'dated 16/04/2026 for INR 3,99,088 drawn on Karur Vysya Bank, Godown Street Branch. '
        + 'The cheque was dishonoured for insufficient funds. Chennai.';
      extractQueue.push(patch([{ key: 'sender_name', value: 'THOORIGAI PRINTS', confidence: 'stated', source: 'x' }]));
      engineQueue.push({ kind: 'issues', issues: [{ field: 'notice_date', code: 'required', message: 'x' }] });
      await intakeService.start(DOC, doc, CTX);
      expect(detCalls.length).toBe(0);       // did NOT use the rule extractor
      // (the LLM `extract` mock was used instead — proven by the extractQueue draining)
      expect(extractQueue.length).toBe(0);
    } finally {
      (env as { intakeDeterministic: boolean }).intakeDeterministic = false;
    }
  });
});

describe('intake loop — a bare answer to a question is accepted (no infinite re-ask)', () => {
  it('answering "gowtham" to the advocate-name question fills it and moves on', async () => {
    (env as { intakeDeterministic: boolean }).intakeDeterministic = true;
    try {
      // Turn 1: engine asks for advocate_name (via a phrased question). The det
      // extractor is REAL here (not mocked) — but the START message has no advocate,
      // so nothing fills; the question is asked and `pending` is recorded.
      engineQueue.push({ kind: 'issues', issues: [{ field: 'advocate_name', code: 'required', message: 'x' }] });
      let state = await intakeService.start(DOC, 'A cheque bounced.', CTX);
      expect(state.questions.map((q) => q.field)).toContain('advocate_name');

      // Turn 2: the advocate answers with a bare "gowtham". The bare-answer fallback
      // assigns it to advocate_name (the pending field), so the engine no longer
      // flags it — the loop advances instead of re-asking the SAME question.
      engineQueue.push({ kind: 'issues', issues: [{ field: 'notice_date', code: 'required', message: 'x' }] });
      state = await intakeService.reply(state.matterId, DOC, 'gowtham', CTX);

      const adv = state.factSheet.flatMap((s) => s.fields).find((f) => f.key === 'advocate_name');
      expect(adv?.value).toBe('gowtham');                       // captured
      expect(state.questions.map((q) => q.field)).not.toContain('advocate_name'); // not re-asked
    } finally {
      (env as { intakeDeterministic: boolean }).intakeDeterministic = false;
    }
  });
});

describe('markSyntheticDates — draft-now sentinel-date marking (real engine output)', () => {
  // Real block texts from an actual engine render (s.138), where the cheque's own
  // date (2026-04-16) was substituted for four MISSING dates (notice, presentation,
  // memo, memo-received) so draft-now could generate. The bug this guards: a blind
  // find-and-replace would ALSO mask the TRUE cheque date printed in the cheque-
  // particulars line — that must be left alone; only the synthetic occurrences mark.
  const outcome = {
    outcome: 'generated' as const,
    docType: 's138_notice',
    signals: { review_banner: '', unverified_marker: '' },
    unfilledSlots: [],
    docxBase64: null,
    templateId: 's138_notice.docx',
    templateVersion: 2,
    blocks: [
      { key: 'p8', text: 'Dated: 2026-04-16' },
      { key: 'p23', text: '   (1) Cheque No. 000105 dated 2026-04-16 for Rs. 399088/- (three lakh ninety-nine thousand eighty-eight rupees only), drawn on Karur Vysya Bank, Godown Street Branch.' },
      { key: 'p25', text: '4. The said cheque(s) were presented for encashment on 2026-04-16 through [bank where presented to be provided], within the period of their validity.' },
      { key: 'p26', text: '5. The said cheque(s) were returned dishonoured vide memo dated 2026-04-16 for the reason [reason for return to be provided].' },
      { key: 'p27', text: '6. The dishonour memo was received by my client on 2026-04-16.' },
    ],
  };

  it('marks the synthetic notice/presentation/memo/received dates', () => {
    const marked = markSyntheticDates(outcome, new Set(['2026-04-16']));
    const byKey = Object.fromEntries(marked.blocks.map((b) => [b.key, b.text]));
    expect(byKey.p8).toContain('[DATE TO BE CONFIRMED]');
    expect(byKey.p25).toContain('[DATE TO BE CONFIRMED]');
    expect(byKey.p26).toContain('[DATE TO BE CONFIRMED]');
    expect(byKey.p27).toContain('[DATE TO BE CONFIRMED]');
  });

  it('does NOT mask the TRUE cheque date in the cheque-particulars line', () => {
    const marked = markSyntheticDates(outcome, new Set(['2026-04-16']));
    const byKey = Object.fromEntries(marked.blocks.map((b) => [b.key, b.text]));
    expect(byKey.p23).toContain('Cheque No. 000105 dated 2026-04-16');
    expect(byKey.p23).not.toContain('[DATE TO BE CONFIRMED]');
  });

  it('is a no-op when there are no synthetic dates', () => {
    const marked = markSyntheticDates(outcome, new Set());
    expect(marked).toBe(outcome);
  });
});

describe('writ_petition draft-now date placeholders', () => {
  it('writ_petition: the filing year is the current year, not "[year to be provided]" (r10)', () => {
    expect(placeholderFor({ key: 'year', label: 'Year', type: 'text', required: true })).toBe(String(new Date().toISOString().slice(0, 4)));
  });
  // r16 (user): the petition, verification and affidavit are dated the filing day, not "[day to be provided]".
  it('test_writ_petition_dated: day and month of signing are today', () => {
    vi.useFakeTimers({ now: new Date('2026-11-08T06:00:00Z') });
    try {
      expect(placeholderFor({ key: 'day', label: 'Day', type: 'text', required: true })).toBe('8th');
      expect(placeholderFor({ key: 'month', label: 'Month', type: 'text', required: true })).toBe('November');
      vi.setSystemTime(new Date('2026-11-22T06:00:00Z'));
      expect(placeholderFor({ key: 'day', label: 'Day', type: 'text', required: true })).toBe('22nd');
      vi.setSystemTime(new Date('2026-11-11T06:00:00Z'));
      expect(placeholderFor({ key: 'day', label: 'Day', type: 'text', required: true })).toBe('11th');
    } finally {
      vi.useRealTimers();
    }
  });
  it('injunction: the ex parte notice-futility averment is drafted from the facts, not a "[... to be provided]" gap (r10)', () => {
    expect(placeholderFor({ key: 'notice_futility', label: 'Notice futility', type: 'text', required: false })).toBe('[to be drafted]');
  });
});
