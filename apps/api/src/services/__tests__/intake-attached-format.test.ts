import { beforeEach, describe, expect, it, vi } from 'vitest';

// "Draft in this format" from the chat: the attached file is read into a spec
// (format-reader, mocked), kept on the conversation's fact sheet, and every
// later turn drafts through /v1/draft-spec with that spec. No live engine, LLM
// or DB: the fact sheet uses its in-memory fallback.

const SPEC = {
  title: 'Rent Demand Notice',
  court_issued: false,
  fields: [
    { key: 'tenant_name', kind: 'string', required: true, label: 'Tenant name' },
    { key: 'rent_due', kind: 'string', required: true, label: 'Rent due' },
  ],
  blocks: [{ key: 'body', text: 'To {{tenant_name}}, pay {{rent_due}}.' }],
};

const readResult = {
  isLegalFormat: true, title: 'Rent Demand Notice', spec: SPEC, reviewNotes: {},
  ok: true, problems: [] as string[], preview: [], equivalent: null,
  sourceName: 'rent-notice-format.docx', sourceSha256: 'x',
  usage: { model: 'test-reader', tokensIn: 1, tokensOut: 1 },
};
const readCalls: string[] = [];
vi.mock('../format-reader.service', () => ({
  formatReader: {
    async read(input: { fileName: string }) {
      readCalls.push(input.fileName);
      return { ...readResult };
    },
  },
}));

const specCalls: Array<{ docType: string; spec: unknown; fields: Record<string, unknown> }> = [];
vi.mock('../engine-client.service', () => {
  class EngineValidationError extends Error {
    constructor(public issues: Array<{ field: string; code: string; message: string }>) {
      super('validation');
    }
  }
  return {
    EngineValidationError,
    EngineDisabledError: class extends Error {},
    EngineError: class extends Error {},
    engineClient: {
      async docTypes() { return { doc_types: [] }; },
      async draft() { throw new Error('built-in draft must not be called for an attached format'); },
      async draftSpec(docType: string, spec: unknown, _v: number, _m: string, fields: Record<string, unknown>) {
        specCalls.push({ docType, spec, fields });
        return {
          outcome: 'generated', docType,
          signals: { review_banner: 'REVIEW BEFORE FILING', unverified_marker: '' },
          unfilledSlots: [], blocks: [{ key: 'body', text: 'To Ravi, pay Rs. 40,000.' }], docxBase64: null,
          templateId: 'spec', templateVersion: 1,
        };
      },
    },
  };
});

vi.mock('../intake-llm.service', () => ({
  intakeLlm: {
    async extract() {
      return {
        fields: [
          { key: 'tenant_name', value: 'Ravi', confidence: 'stated', source: 'Ravi' },
          { key: 'rent_due', value: 'Rs. 40,000', confidence: 'stated', source: 'Rs. 40,000' },
        ],
        unmappedNotes: [], lowConfidence: [], collisions: [], modelUsed: 'test',
      };
    },
    async phrase() { return []; },
    async classifyDocType() { return { label: null, confidence: 'low' as const }; },
  },
  MONTH_NAMES: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
}));
vi.mock('../intake-compose.service', () => ({
  intakeCompose: {
    async compose(args: { engineBlocks: unknown }) {
      return { composed: false, blocks: args.engineBlocks, modelUsed: 'engine:template' };
    },
  },
}));
vi.mock('../ai-usage.service', () => ({ aiUsageService: { recordAsync: () => {} } }));
vi.mock('../../lib/anthropic-client', () => ({
  claudeComplete: async () => { throw new Error('claude unavailable'); },
}));

import { intakeService, isAttachedFormatLabel, IntakeUnavailableError } from '../intake.service';

// Each test attaches DIFFERENT bytes: the same file is read only once (cached).
let fileSeq = 0;
const newFile = () => ({ fileName: 'rent-notice-format.docx', mime: 'application/msword', dataBase64: Buffer.from(`format ${++fileSeq}`).toString('base64') });
const CTX = { firmId: null, userId: '00000000-0000-0000-0000-000000000001' };

describe('intake — draft in an attached format', () => {
  beforeEach(() => {
    readCalls.length = 0;
    specCalls.length = 0;
    readResult.isLegalFormat = true;
    readResult.ok = true;
  });

  it('reads the file once and drafts every turn from its spec', async () => {
    const started = await intakeService.startWithFormat('Tenant Ravi owes Rs. 40,000.', newFile(), CTX);
    expect(readCalls).toEqual(['rent-notice-format.docx']);
    expect(started.docLabel).toBe('Rent Demand Notice (attached format)');
    expect(isAttachedFormatLabel(started.docLabel)).toBe(true);

    const drafted = await intakeService.draftNow(started.matterId, started.docLabel, CTX);
    expect(drafted.status).toBe('generated');
    const last = specCalls[specCalls.length - 1]!;
    expect(last.docType).toMatch(/^attached_format_[0-9a-f]{32}$/);
    expect(last.spec).toEqual(SPEC);
    expect(last.fields).toMatchObject({ tenant_name: 'Ravi', rent_due: 'Rs. 40,000' });
    // The format was not re-read on later turns.
    expect(readCalls).toHaveLength(1);
  });

  it('lists the reader\'s law updates on the draft (an old format)', async () => {
    const old = readResult.reviewNotes;
    readResult.reviewNotes = { law_updates: [{ original: 'Section 420 IPC', updated: 'Section 318(4) BNS', note: 'IPC repealed' }] } as never;
    try {
      const started = await intakeService.startWithFormat('Tenant Ravi owes Rs. 40,000.', newFile(), CTX);
      const drafted = await intakeService.draftNow(started.matterId, started.docLabel, CTX);
      expect(drafted.draftNotes?.[0]).toContain('Section 420 IPC');
      expect(drafted.draftNotes?.[0]).toContain('Section 318(4) BNS');
    } finally {
      readResult.reviewNotes = old;
    }
  });

  it('reads the same file only once', async () => {
    const file = newFile();
    await intakeService.startWithFormat('Tenant Ravi owes Rs. 40,000.', file, CTX);
    const again = await intakeService.startWithFormat('Another tenant.', file, CTX);
    expect(readCalls).toHaveLength(1);
    expect(again.docLabel).toBe('Rent Demand Notice (attached format)');
  });

  it('reports why it could not save without a firm', async () => {
    const s = await intakeService.startWithFormat('Tenant Ravi owes Rs. 40,000.', newFile(), CTX, { save: true });
    expect(s.formatSave).toMatchObject({ saved: false });
  });

  it('does not resolve for another firm', async () => {
    const started = await intakeService.startWithFormat('Tenant Ravi owes Rs. 40,000.', newFile(), CTX);
    await expect(
      intakeService.draftNow(started.matterId, started.docLabel, { ...CTX, firmId: '00000000-0000-0000-0000-0000000000ff' }),
    ).rejects.toThrow(/not intake-routable/);
  });

  it('refuses a file that is not a drafting format', async () => {
    readResult.isLegalFormat = false;
    await expect(intakeService.startWithFormat('draft in this format', newFile(), CTX))
      .rejects.toBeInstanceOf(IntakeUnavailableError);
  });
});
