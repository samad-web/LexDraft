import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { factSheetService as FactSheetSvc } from '../factsheet.service';
import type { engineClient as EngineClientSvc } from '../engine-client.service';

// The client reads env at import; set the URL BEFORE importing so hasEngineService
// is true. Modules are imported in beforeAll after the env is stubbed.
let factSheetService: typeof FactSheetSvc;
let engineClient: typeof EngineClientSvc;
let EngineValidationError: any;
let EngineSignoffConflict: any;

beforeAll(async () => {
  vi.stubEnv('ENGINE_SERVICE_URL', 'http://engine.test');
  vi.stubEnv('ENGINE_SERVICE_TOKEN', 'tok');
  ({ factSheetService } = await import('../factsheet.service'));
  ({ engineClient, EngineValidationError, EngineSignoffConflict } = await import(
    '../engine-client.service'
  ));
});

const CTX = { firmId: 'f', userId: 'u' };

function mockFetch(status: number, json: unknown) {
  return vi.fn(async () => ({
    status,
    json: async () => json,
  })) as unknown as typeof fetch;
}

describe('engine-client — version resolution + status mapping', () => {
  beforeEach(() => factSheetService._resetMemory());
  afterEach(() => vi.restoreAllMocks());

  it('draft() sends the CURRENT fact-sheet version (never a stale one)', async () => {
    const sheet = await factSheetService.create({ x: 1 }, CTX);
    await factSheetService.revise(sheet.matterId, { x: 2 }, CTX); // now version 2

    const spy = mockFetch(200, {
      outcome: 'generated', signals: {}, unfilled_slots: [], blocks: [], docx_base64: null,
    });
    vi.stubGlobal('fetch', spy);

    await engineClient.draft('s138_notice', sheet.matterId, { any: 'field' });

    const body = JSON.parse((spy as any).mock.calls[0][1].body);
    expect(body.matter.matter_id).toBe(sheet.matterId);
    expect(body.matter.version).toBe(2); // the CURRENT version, not 1
  });

  it('draft() returns a refusal (200) as a value, not an exception', async () => {
    const sheet = await factSheetService.create({}, CTX);
    vi.stubGlobal('fetch', mockFetch(200, {
      outcome: 'refused',
      refusal: { code: 's138_notice_cheque_presented_after_validity',
                 fields_implicated: ['cheques[].date'] },
    }));
    const res = await engineClient.draft('s138_notice', sheet.matterId, {});
    expect(res.outcome).toBe('refused');
    if (res.outcome === 'refused') {
      expect(res.refusal.code).toBe('s138_notice_cheque_presented_after_validity');
      expect(res.refusal.fields_implicated).toContain('cheques[].date');
    }
  });

  it('draft() maps 422 to EngineValidationError (a client error, not a refusal)', async () => {
    const sheet = await factSheetService.create({}, CTX);
    vi.stubGlobal('fetch', mockFetch(422, {
      error: 'validation',
      issues: [{ field: 'memo_received_date', code: 'required', message: 'required' }],
    }));
    await expect(engineClient.draft('s138_notice', sheet.matterId, {}))
      .rejects.toBeInstanceOf(EngineValidationError);
  });

  it('draftS138Bundle() sends the current version + affidavit particulars', async () => {
    const sheet = await factSheetService.create({}, CTX);
    const spy = mockFetch(200, {
      outcome: 'generated',
      bundle: 's138_complaint',
      complaint: { outcome: 'generated', signals: {}, unfilled_slots: [], blocks: [], docx_base64: 'AA' },
      affidavit: { outcome: 'generated', signals: {}, unfilled_slots: [], blocks: [], docx_base64: 'BB' },
    });
    vi.stubGlobal('fetch', spy);

    const res = await engineClient.draftS138Bundle(
      sheet.matterId,
      { complainant_name: 'Ramesh' },
      { deponentAge: 42, deponentOccupation: 'business', attestor: 'Notary' },
    );

    const [url, init] = (spy as any).mock.calls[0];
    expect(url).toContain('/v1/draft-bundle/s138_complaint');
    const body = JSON.parse(init.body);
    expect(body.matter.version).toBe(1);
    expect(body.affidavit).toEqual({
      deponent_age: 42, deponent_occupation: 'business', attestor: 'Notary',
    });
    expect(res.outcome).toBe('generated');
    if (res.outcome === 'generated') {
      expect(res.complaint.outcome).toBe('generated');
      expect(res.affidavit.outcome).toBe('generated');
    }
  });

  it('draftS138Bundle() returns a complaint refusal (200) as a value', async () => {
    const sheet = await factSheetService.create({}, CTX);
    vi.stubGlobal('fetch', mockFetch(200, {
      outcome: 'refused', for: 's138_complaint',
      refusal: { code: 's138_complaint_company_accused_no_s141_averment', fields_implicated: ['s141_averment'] },
    }));
    const res = await engineClient.draftS138Bundle(
      sheet.matterId, {}, { deponentAge: 42, deponentOccupation: 'x', attestor: 'y' },
    );
    expect(res.outcome).toBe('refused');
    if (res.outcome === 'refused') {
      expect(res.for).toBe('s138_complaint');
      expect(res.refusal.code).toBe('s138_complaint_company_accused_no_s141_averment');
    }
  });

  it('draftS138Bundle() surfaces a per-document (affidavit) refusal inside a generated bundle', async () => {
    const sheet = await factSheetService.create({}, CTX);
    vi.stubGlobal('fetch', mockFetch(200, {
      outcome: 'generated', bundle: 's138_complaint',
      complaint: { outcome: 'generated', signals: {}, unfilled_slots: [], blocks: [], docx_base64: 'AA' },
      affidavit: { outcome: 'refused', refusal: { code: 's138_affidavit_cheque_presented_after_validity', fields_implicated: ['cheque_dates'] } },
    }));
    const res = await engineClient.draftS138Bundle(
      sheet.matterId, {}, { deponentAge: 42, deponentOccupation: 'x', attestor: 'y' },
    );
    expect(res.outcome).toBe('generated');
    if (res.outcome === 'generated') {
      expect(res.complaint.outcome).toBe('generated');
      expect(res.affidavit.outcome).toBe('refused');
      if (res.affidavit.outcome === 'refused') {
        expect(res.affidavit.refusal.code).toBe('s138_affidavit_cheque_presented_after_validity');
      }
    }
  });

  it('draftS138Bundle() maps 422 to EngineValidationError', async () => {
    const sheet = await factSheetService.create({}, CTX);
    vi.stubGlobal('fetch', mockFetch(422, {
      error: 'validation',
      issues: [{ field: 'affidavit.attestor', code: 'required', message: 'required' }],
    }));
    await expect(
      engineClient.draftS138Bundle(sheet.matterId, {}, { deponentAge: 42, deponentOccupation: 'x', attestor: '' }),
    ).rejects.toBeInstanceOf(EngineValidationError);
  });

  it('signOff() sends the current version and maps 409 to a conflict', async () => {
    const sheet = await factSheetService.create({}, CTX);
    vi.stubGlobal('fetch', mockFetch(409, { detail: { message: 'unfilled slot' } }));
    await expect(
      engineClient.signOff({
        docType: 's138_notice', matterId: sheet.matterId,
        reviewer: 'Adv', signedOn: '2026-09-01', context: {},
      }),
    ).rejects.toBeInstanceOf(EngineSignoffConflict);
  });

  it('signOff() sends the CURRENT version so a later revise makes it stale', async () => {
    const sheet = await factSheetService.create({}, CTX);
    const spy = mockFetch(200, { version: 1 });
    vi.stubGlobal('fetch', spy);
    await engineClient.signOff({
      docType: 's138_notice', matterId: sheet.matterId,
      reviewer: 'Adv', signedOn: '2026-09-01', context: {},
    });
    const body = JSON.parse((spy as any).mock.calls[0][1].body);
    expect(body.matter.version).toBe(1); // signed against v1; a revise -> v2 is stale
  });
});
