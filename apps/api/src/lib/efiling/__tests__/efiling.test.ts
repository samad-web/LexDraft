import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { evaluateReadiness, isMactCaseType, EFILING_MAX_UPLOAD_BYTES } from '../readiness';
import { nameSimilarity, nameTokens, narrowCandidates, splitTitle } from '../match';
import { PORTAL_STEPS_BY_KIND, type FilingParticulars, type FilingParty } from '../types';
import { canTransition, missingBeforeSubmit } from '../../../services/efiling-filings.service';
import { partySearchTerm } from '../../../services/efiling-tracker.service';
import { assembleBundle } from '../../../services/efiling-bundle.service';

const baseParticulars: FilingParticulars = {
  caseId: 'c1', courtTier: 'DC', stateCode: 4, districtCode: 2, courtCode: 1, estCode: 'KLER01', courtComplexCode: null,
  establishmentName: 'Principal Munsiff Court', caseTypeCode: '7', caseTypeName: 'O.S.', isUrgent: false,
  hcSide: null, hcMatterType: null, hcBench: null,
  causeOfAction: 'Non-payment of rent', causeOfActionDate: '2026-01-10', disputePlace: 'Ernakulam',
  subject: null, prayer: 'Decree for Rs. 2,00,000', reliefParticulars: null, valuationInr: 200000,
  claimAmountInr: null, acts: [{ act: 'CPC', section: 'O.VII R.1' }], hideParty: false, hidePartyReason: null,
  localLanguage: null, plaintLocal: null, mact: null, extra: {}, updatedAt: null,
};

function party(over: Partial<FilingParty>): FilingParty {
  return {
    id: Math.random().toString(36).slice(2), caseId: 'c1', side: 'petitioner', position: 0, isClient: false, isOrganization: false,
    name: 'K Ramesh Kumar', relationType: 'S/o', relationName: 'Krishnan', gender: 'M', age: 45, dateOfBirth: null,
    occupation: 'Business', address: 'MG Road, Kochi', district: 'Ernakulam', state: 'Kerala', pinCode: '682001',
    mobile: '9876543210', email: null, isMinor: false, guardianName: null, orgRepresentative: null,
    legalHeirOf: null, nameLocal: null, addressLocal: null, extra: {}, ...over,
  };
}

const goodInput = () => ({
  particulars: { ...baseParticulars },
  parties: [party({ isClient: true }), party({ side: 'respondent', name: 'Suresh Babu' })],
  facts: [{ id: 'f1', caseId: 'c1', position: 0, factDate: '2026-01-01', factTime: null, description: 'Lease signed' }],
  documents: [{ id: 'd1', position: 0, label: 'Plaint', sourceKind: 'document' as const, sourceId: 'x', pageCount: 4, sizeBytes: 1000 }],
  bundle: { sizeBytes: 5000 },
});

describe('evaluateReadiness', () => {
  it('passes a complete civil filing', () => {
    const r = evaluateReadiness(goodInput());
    expect(r.errors).toBe(0);
    expect(r.ready).toBe(true);
  });

  it('rejects a state that is not on the portal', () => {
    const input = goodInput();
    input.particulars.stateCode = 99; // not one of the 30 portal states
    const r = evaluateReadiness(input);
    expect(r.ready).toBe(false);
    expect(r.issues.some((i) => i.field === 'stateCode' && i.severity === 'error')).toBe(true);
  });

  it('requires a guardian for a minor and both sides', () => {
    const input = goodInput();
    input.parties = [party({ age: 12, guardianName: null })];
    const r = evaluateReadiness(input);
    expect(r.issues.some((i) => i.field.endsWith(':guardianName'))).toBe(true);
    expect(r.issues.some((i) => i.field === 'respondent')).toBe(true);
  });

  it('requires MACT details only for motor-accident case types', () => {
    const input = goodInput();
    input.particulars.caseTypeName = 'M.A.C.T. O.P.';
    expect(isMactCaseType(input.particulars)).toBe(true);
    const r = evaluateReadiness(input);
    expect(r.issues.filter((i) => i.section === 'mact' && i.severity === 'error').length).toBeGreaterThan(0);
    expect(isMactCaseType({ caseTypeName: 'O.S.', caseTypeCode: '7' })).toBe(false);
  });

  it('requires the client party to be marked (portal Initial Inputs)', () => {
    const input = goodInput();
    input.parties = input.parties.map((x) => ({ ...x, isClient: false }));
    const r = evaluateReadiness(input);
    expect(r.issues.some((i) => i.field === 'client' && i.severity === 'error')).toBe(true);
  });

  it('requires side and bench for High Court filings', () => {
    const input = goodInput();
    input.particulars.courtTier = 'HC';
    let r = evaluateReadiness(input);
    expect(r.issues.map((i) => i.field)).toEqual(expect.arrayContaining(['hcSide', 'hcBench']));
    input.particulars.hcSide = 'civil';
    input.particulars.hcBench = 'Principal Seat';
    input.particulars.hcMatterType = 'Writ Petition';
    r = evaluateReadiness(input);
    expect(r.issues.some((i) => i.field.startsWith('hc'))).toBe(false);
  });

  it('flags an oversize bundle', () => {
    const input = goodInput();
    input.bundle = { sizeBytes: EFILING_MAX_UPLOAD_BYTES + 1 };
    expect(evaluateReadiness(input).ready).toBe(false);
  });
});

describe('name matching', () => {
  it('normalises honorifics, parentage and punctuation', () => {
    expect(nameTokens('Sri. K. Ramesh Kumar S/o Krishnan')).toEqual(['K', 'RAMESH', 'KUMAR']);
    expect(nameTokens('M/s. Acme Traders Pvt. Ltd.')).toEqual(['ACME', 'TRADERS', 'PVT', 'LTD']);
  });

  it('scores the same person highly and a different person low', () => {
    expect(nameSimilarity('K Ramesh Kumar', 'RAMESH KUMAR K')).toBeGreaterThanOrEqual(0.75);
    expect(nameSimilarity('K Ramesh Kumar', 'Suresh Kumar')).toBeLessThan(0.75);
  });

  it('splits eCourts titles', () => {
    expect(splitTitle('A KUMAR v. STATE OF KERALA')).toEqual({ pet: 'A KUMAR', res: 'STATE OF KERALA' });
  });

  it('needs both sides to match and skips CNRs already in use', () => {
    const candidates = [
      { cino: 'KLER010000012026', title: 'RAMESH KUMAR K v. SURESH BABU', establishment: null, caseNo: null },
      { cino: 'KLER010000022026', title: 'RAMESH KUMAR K v. STATE BANK', establishment: null, caseNo: null },
      { cino: 'KLER010000032026', title: 'RAMESH KUMAR v. SURESH BABU P', establishment: null, caseNo: null },
    ];
    const narrowed = narrowCandidates({
      petitioner: 'K Ramesh Kumar', respondent: 'Suresh Babu', candidates,
      takenCnrs: new Set(['KLER010000032026']),
    });
    expect(narrowed.map((c) => c.cino)).toEqual(['KLER010000012026']);
  });

  it('picks the longest real word to search eCourts with', () => {
    expect(partySearchTerm('Sri K. Ramesh Kumar')).toBe('RAMESH');
    expect(partySearchTerm('K. R.')).toBeNull();
  });
});

describe('filing status machine (portal order)', () => {
  it('goes prepared -> efiled on portal -> final submitted -> scrutiny -> registered', () => {
    expect(canTransition('draft', 'ready')).toBe(true);
    expect(canTransition('ready', 'efiled')).toBe(true);
    expect(canTransition('efiled', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'objected')).toBe(true);
    expect(canTransition('objected', 'refiled')).toBe(true);
    expect(canTransition('refiled', 'registered')).toBe(true);
  });

  it('cannot final-submit before the case is on the portal, or go back after', () => {
    expect(canTransition('ready', 'submitted')).toBe(false);
    expect(canTransition('draft', 'submitted')).toBe(false);
    expect(canTransition('efiled', 'draft')).toBe(false);
    expect(canTransition('registered', 'draft')).toBe(false);
    expect(canTransition('objected', 'registered')).toBe(false);
  });
});

describe('portal steps per filing type', () => {
  it('lists new-case steps in the manual\'s order', () => {
    expect(PORTAL_STEPS_BY_KIND.new_case.map((s) => s.key)).toEqual(
      ['efile_case', 'vakalat', 'upload', 'indexing', 'esign', 'oath', 'court_fee', 'final_submit'],
    );
  });

  it('gives an IA its own flow: application, fee, advocate + litigant OTP', () => {
    expect(PORTAL_STEPS_BY_KIND.ia.map((s) => s.key)).toEqual(['ia_application', 'ia_fee', 'ia_auth_advocate', 'ia_auth_litigant']);
  });

  it('blocks final submit until required steps are done and optional ones are decided', () => {
    const steps = { efile_case: 'done', upload: 'done', final_submit: 'pending' } as const;
    const missing = missingBeforeSubmit({ kind: 'new_case', steps });
    expect(missing).toEqual(['Vakalat', 'Index the documents', 'eSign', 'Record oath', 'Pay court fee']);
    const decided = {
      ...steps, vakalat: 'done', indexing: 'not_applicable', esign: 'done', oath: 'not_applicable', court_fee: 'done',
    } as const;
    expect(missingBeforeSubmit({ kind: 'new_case', steps: decided })).toEqual([]);
  });

  it('an IA is submitted only after both authentications', () => {
    expect(missingBeforeSubmit({ kind: 'ia', steps: { ia_application: 'done', ia_fee: 'done', ia_auth_advocate: 'done' } }))
      .toEqual(['Litigant authentication']);
  });
});

describe('assembleBundle', () => {
  async function pdfWithPages(n: number): Promise<Buffer> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < n; i++) doc.addPage();
    return Buffer.from(await doc.save());
  }

  it('merges behind an index with continuous page ranges and bookmarks', async () => {
    const { bytes, pages, index } = await assembleBundle('Ramesh v. Suresh', [
      { label: 'Plaint', pdf: await pdfWithPages(3) },
      { label: 'Vakalatnama', pdf: await pdfWithPages(1) },
      { label: 'Document 1 – lease deed', pdf: await pdfWithPages(2) },
    ]);
    expect(pages).toBe(1 + 3 + 1 + 2);
    expect(index).toEqual([
      { label: 'Plaint', fromPage: 2, toPage: 4 },
      { label: 'Vakalatnama', fromPage: 5, toPage: 5 },
      { label: 'Document 1 – lease deed', fromPage: 6, toPage: 7 },
    ]);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(7);
    expect(out.catalog.get(PDFName.of('Outlines'))).toBeDefined();
  });

  it('refuses something that is not a PDF', async () => {
    await expect(assembleBundle('x', [{ label: 'Photo', pdf: Buffer.from('not a pdf') }])).rejects.toThrow(/Photo/);
  });
});
