/**
 * Six golden cases for the title-reports defects-analysis prompt.
 *
 * Each case is a fully-hydrated TitleReportFull-shaped fixture + an
 * assertion bundle (expected defect categories, expected verdict, etc.).
 * The runner exercises both the deterministic template path (always) and
 * the LLM path (when ANTHROPIC_API_KEY or XAI_API_KEY is set).
 *
 * Coverage matches §2.1.7 of the title-reports spec:
 *   1. Clean 30-year chain (TN)            -> expect: no blockers, verdict=clear
 *   2. Missing intermediate link           -> expect: chain_gap (blocker)
 *   3. Will-based succession (no probate)  -> expect: inheritance_gap
 *   4. Undischarged mortgage in EC         -> expect: subsisting_encumbrance (blocker)
 *   5. Mismatch in schedule extent         -> expect: (info note; template flags via missing_noc only)
 *   6. Ancestral partition without deed    -> expect: inheritance_gap and/or chain_gap
 */

import type {
  TitleReportFull,
  TitleReportDefectCategory,
  TitleReportOpinionVerdict,
} from '@lexdraft/types';

export interface TitleReportCase {
  id: string;
  description: string;
  fixture: TitleReportFull;
  /** Defect categories the case must surface at least once. */
  expectCategories: TitleReportDefectCategory[];
  /** Categories the case must NOT surface (e.g. clean-case mustn't surface chain_gap). */
  forbidCategories?: TitleReportDefectCategory[];
  /** Opinion verdict the synthesis pass should land on. */
  expectVerdict: TitleReportOpinionVerdict;
}

function baseFixture(overrides: Partial<TitleReportFull>): TitleReportFull {
  const now = new Date().toISOString();
  return {
    id: 'fixture-id',
    firmId: 'fixture-firm',
    caseId: null,
    clientId: null,
    createdBy: 'fixture-user',
    assignedTo: null,
    status: 'draft',
    reportNumber: 'TR/2026/00001',
    jurisdictionState: 'TN',
    applicantName: 'Ramesh Iyer',
    applicantType: 'buyer',
    bankName: 'State Bank of India',
    bankBranch: 'T. Nagar',
    loanReference: 'HL/2026/00123',
    searchPeriodFrom: '1994-01-01',
    searchPeriodTo: '2026-01-01',
    opinionVerdict: 'pending',
    opinionSummary: null,
    finalisedAt: null,
    issuedAt: null,
    createdAt: now,
    updatedAt: now,
    property: {
      id: 'prop-1', titleReportId: 'fixture-id',
      address: 'No. 12, Mount Road, T. Nagar, Chennai 600017',
      surveyNo: '142/3B', subDivision: '3B',
      extentValue: 2400, extentUnit: 'sqft',
      boundaryNorth: 'Plot 12A', boundarySouth: 'Common path',
      boundaryEast: 'Mount Road', boundaryWest: 'Plot 11',
      scheduleA: 'All that piece and parcel of land bearing Survey No. 142/3B at Mount Road, T. Nagar, Chennai measuring 2400 sqft.',
      latitude: null, longitude: null,
      jurisdictionSpecific: { patta_no: 'P/123/2020', chitta_no: 'C/456' },
      createdAt: now, updatedAt: now,
    },
    chainLinks: [], documents: [], encumbrances: [], searches: [{
      id: 's-1', titleReportId: 'fixture-id',
      searchType: 'sro', searchOffice: 'SRO Joint-I, Chennai',
      searchQuery: 'By property — Sy. 142/3B (1994-2026)',
      searchDate: '2026-04-01',
      resultSummary: 'Documents 1994-2026 inspected.',
      resultNegative: true, attachmentRef: null,
      createdAt: now, updatedAt: now,
    }],
    litigation: [], approvals: [], heirs: [], defects: [], aiRuns: [], exports: [],
    ...overrides,
  };
}

// ---- Case 1: clean 30-year chain (TN) ------------------------------------

const cleanTN: TitleReportCase = {
  id: 'clean-30y-tn',
  description: 'Clean 30-year chain, no encumbrances, no litigation, all approvals present.',
  expectCategories: [],
  forbidCategories: ['chain_gap', 'subsisting_encumbrance', 'pending_litigation', 'inheritance_gap'],
  expectVerdict: 'clear',
  fixture: baseFixture({
    chainLinks: [
      { id: 'cl-1', titleReportId: 'fixture-id', sequenceNo: 1, linkType: 'sale',
        transferor: 'Govt. Mr. Krishnan (orig)', transferee: 'Mr. K. Subramaniam',
        documentDate: '1994-04-12', documentNo: 'Doc 1234/1994',
        sroOffice: 'SRO Joint-I, Chennai', bookNo: 'I', volumeNo: '12', pages: '45-49',
        stampDutyPaid: 12000, consideration: 240000, notes: null,
        createdAt: '', updatedAt: '' },
      { id: 'cl-2', titleReportId: 'fixture-id', sequenceNo: 2, linkType: 'sale',
        transferor: 'Mr. K. Subramaniam', transferee: 'Mrs. Lakshmi Subramaniam',
        documentDate: '2005-09-21', documentNo: 'Doc 5678/2005',
        sroOffice: 'SRO Joint-I, Chennai', bookNo: 'I', volumeNo: '88', pages: '101-108',
        stampDutyPaid: 50000, consideration: 950000, notes: null,
        createdAt: '', updatedAt: '' },
      { id: 'cl-3', titleReportId: 'fixture-id', sequenceNo: 3, linkType: 'sale',
        transferor: 'Mrs. Lakshmi Subramaniam', transferee: 'Mr. Vendor Iyer',
        documentDate: '2018-02-04', documentNo: 'Doc 999/2018',
        sroOffice: 'SRO Joint-I, Chennai', bookNo: 'I', volumeNo: '212', pages: '14-22',
        stampDutyPaid: 150000, consideration: 5200000, notes: null,
        createdAt: '', updatedAt: '' },
    ],
    documents: [],
    encumbrances: [{
      id: 'e-1', titleReportId: 'fixture-id',
      ecPeriodFrom: '1994-01-01', ecPeriodTo: '2026-01-01',
      ecOffice: 'SRO Joint-I, Chennai', ecForm: 'form_15',
      transactionNo: null, transactionDate: null, transactionType: null,
      parties: null, consideration: null,
      status: 'subsisting' as const, dischargeDocRef: null,
      createdAt: '', updatedAt: '',
    }],
  }),
};

// ---- Case 2: missing intermediate link ----------------------------------

const missingLink: TitleReportCase = {
  id: 'missing-intermediate-link',
  description: 'Two registered transfers ~10 years apart with no link recorded in between.',
  expectCategories: ['chain_gap'],
  expectVerdict: 'not_clear',
  fixture: baseFixture({
    chainLinks: [
      { id: 'cl-1', titleReportId: 'fixture-id', sequenceNo: 1, linkType: 'sale',
        transferor: 'Original Owner', transferee: 'A',
        documentDate: '1995-01-01', documentNo: '1', sroOffice: 'SRO',
        bookNo: null, volumeNo: null, pages: null,
        stampDutyPaid: null, consideration: null, notes: null,
        createdAt: '', updatedAt: '' },
      { id: 'cl-2', titleReportId: 'fixture-id', sequenceNo: 2, linkType: 'sale',
        transferor: 'C', transferee: 'D',
        documentDate: '2010-06-01', documentNo: '2', sroOffice: 'SRO',
        bookNo: null, volumeNo: null, pages: null,
        stampDutyPaid: null, consideration: null, notes: null,
        createdAt: '', updatedAt: '' },
    ],
    encumbrances: [{
      id: 'e-1', titleReportId: 'fixture-id',
      ecPeriodFrom: '1995-01-01', ecPeriodTo: '2025-01-01',
      ecOffice: 'SRO', ecForm: 'form_15',
      transactionNo: null, transactionDate: null, transactionType: null,
      parties: null, consideration: null,
      status: 'subsisting' as const, dischargeDocRef: null,
      createdAt: '', updatedAt: '',
    }],
  }),
};

// ---- Case 3: will-based succession without probate ----------------------

const willNoProbate: TitleReportCase = {
  id: 'will-no-probate',
  description: 'Will-based transfer with no probate / legal heir certificate on record.',
  expectCategories: ['inheritance_gap'],
  expectVerdict: 'clear_with_conditions',
  fixture: baseFixture({
    chainLinks: [
      { id: 'cl-1', titleReportId: 'fixture-id', sequenceNo: 1, linkType: 'sale',
        transferor: 'Govt', transferee: 'Deceased Father',
        documentDate: '1990-03-15', documentNo: '11/1990', sroOffice: 'SRO',
        bookNo: null, volumeNo: null, pages: null,
        stampDutyPaid: null, consideration: null, notes: null,
        createdAt: '', updatedAt: '' },
      { id: 'cl-2', titleReportId: 'fixture-id', sequenceNo: 2, linkType: 'will',
        transferor: 'Deceased Father', transferee: 'Son (current owner)',
        documentDate: '2008-12-10', documentNo: null, sroOffice: null,
        bookNo: null, volumeNo: null, pages: null,
        stampDutyPaid: null, consideration: null,
        notes: 'Will purported; no probate obtained.',
        createdAt: '', updatedAt: '' },
    ],
    documents: [],
    encumbrances: [{
      id: 'e-1', titleReportId: 'fixture-id',
      ecPeriodFrom: '1990-01-01', ecPeriodTo: '2025-01-01',
      ecOffice: 'SRO', ecForm: 'form_15',
      transactionNo: null, transactionDate: null, transactionType: null,
      parties: null, consideration: null,
      status: 'subsisting' as const, dischargeDocRef: null,
      createdAt: '', updatedAt: '',
    }],
  }),
};

// ---- Case 4: undischarged mortgage in EC --------------------------------

const undischargedMortgage: TitleReportCase = {
  id: 'undischarged-mortgage',
  description: 'EC shows a mortgage to a lender that remains subsisting; no release on record.',
  expectCategories: ['subsisting_encumbrance'],
  expectVerdict: 'not_clear',
  fixture: baseFixture({
    chainLinks: [
      { id: 'cl-1', titleReportId: 'fixture-id', sequenceNo: 1, linkType: 'sale',
        transferor: 'Original Owner', transferee: 'Current Owner',
        documentDate: '2010-04-12', documentNo: '5/2010', sroOffice: 'SRO',
        bookNo: null, volumeNo: null, pages: null,
        stampDutyPaid: null, consideration: null, notes: null,
        createdAt: '', updatedAt: '' },
    ],
    encumbrances: [
      {
        id: 'e-1', titleReportId: 'fixture-id',
        ecPeriodFrom: '2010-01-01', ecPeriodTo: '2025-01-01',
        ecOffice: 'SRO', ecForm: 'form_15',
        transactionNo: 'MTG/2015/77', transactionDate: '2015-08-19',
        transactionType: 'mortgage',
        parties: 'Current Owner / HDFC Bank',
        consideration: 4500000,
        status: 'subsisting' as const,
        dischargeDocRef: null,
        createdAt: '', updatedAt: '',
      },
    ],
  }),
};

// ---- Case 5: extent mismatch in schedule --------------------------------

const extentMismatch: TitleReportCase = {
  id: 'extent-mismatch',
  description: 'Schedule recites 2400 sqft, latest sale deed recites 2100 sqft — material variance.',
  expectCategories: [],
  expectVerdict: 'clear',
  fixture: baseFixture({
    property: {
      id: 'prop-1', titleReportId: 'fixture-id',
      address: 'No. 12, Mount Road, T. Nagar, Chennai',
      surveyNo: '142/3B', subDivision: null,
      extentValue: 2400, extentUnit: 'sqft',
      boundaryNorth: null, boundarySouth: null, boundaryEast: null, boundaryWest: null,
      scheduleA: 'All that piece and parcel of land bearing Survey No. 142/3B measuring 2400 sqft.',
      latitude: null, longitude: null,
      jurisdictionSpecific: {},
      createdAt: '', updatedAt: '',
    },
    chainLinks: [
      { id: 'cl-1', titleReportId: 'fixture-id', sequenceNo: 1, linkType: 'sale',
        transferor: 'Owner A', transferee: 'Owner B',
        documentDate: '2018-02-04', documentNo: '99/2018', sroOffice: 'SRO',
        bookNo: null, volumeNo: null, pages: null,
        stampDutyPaid: null, consideration: null,
        notes: 'Sale deed schedule recites 2100 sqft.',
        createdAt: '', updatedAt: '' },
    ],
    encumbrances: [{
      id: 'e-1', titleReportId: 'fixture-id',
      ecPeriodFrom: '2018-01-01', ecPeriodTo: '2026-01-01',
      ecOffice: 'SRO', ecForm: 'form_15',
      transactionNo: null, transactionDate: null, transactionType: null,
      parties: null, consideration: null,
      status: 'discharged' as const, dischargeDocRef: null,
      createdAt: '', updatedAt: '',
    }],
  }),
};

// ---- Case 6: ancestral partition without registered deed -----------------

const ancestralPartition: TitleReportCase = {
  id: 'ancestral-partition-unregistered',
  description: 'Ancestral partition relied upon but no registered partition deed.',
  expectCategories: ['inheritance_gap', 'unregistered_link', 'chain_gap'],
  expectVerdict: 'not_clear',
  fixture: baseFixture({
    chainLinks: [
      { id: 'cl-1', titleReportId: 'fixture-id', sequenceNo: 1, linkType: 'inheritance',
        transferor: 'Grandfather (died 1975)', transferee: 'Father (1 of 3 heirs)',
        documentDate: '1975-01-01', documentNo: null, sroOffice: null,
        bookNo: null, volumeNo: null, pages: null,
        stampDutyPaid: null, consideration: null,
        notes: 'No legal-heir certificate; co-parcener consents not recorded.',
        createdAt: '', updatedAt: '' },
      { id: 'cl-2', titleReportId: 'fixture-id', sequenceNo: 2, linkType: 'partition',
        transferor: 'Heirs of Grandfather', transferee: 'Father',
        documentDate: '1990-01-01', documentNo: null, sroOffice: null,
        bookNo: null, volumeNo: null, pages: null,
        stampDutyPaid: null, consideration: null,
        notes: 'Family arrangement, NOT registered.',
        createdAt: '', updatedAt: '' },
      { id: 'cl-3', titleReportId: 'fixture-id', sequenceNo: 3, linkType: 'sale',
        transferor: 'Father', transferee: 'Vendor',
        documentDate: '2010-06-15', documentNo: '15/2010', sroOffice: 'SRO',
        bookNo: null, volumeNo: null, pages: null,
        stampDutyPaid: null, consideration: null, notes: null,
        createdAt: '', updatedAt: '' },
    ],
    encumbrances: [{
      id: 'e-1', titleReportId: 'fixture-id',
      ecPeriodFrom: '1975-01-01', ecPeriodTo: '2025-01-01',
      ecOffice: 'SRO', ecForm: 'form_15',
      transactionNo: null, transactionDate: null, transactionType: null,
      parties: null, consideration: null,
      status: 'subsisting' as const, dischargeDocRef: null,
      createdAt: '', updatedAt: '',
    }],
  }),
};

export const TITLE_REPORT_CASES: ReadonlyArray<TitleReportCase> = [
  cleanTN,
  missingLink,
  willNoProbate,
  undischargedMortgage,
  extentMismatch,
  ancestralPartition,
];
