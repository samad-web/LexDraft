// Request/response shapes for the eFiling (filing.ecourts.gov.in) live
// browser-automation flow. There is no encrypted mobile-API equivalent here
// (unlike lib/ecourts) - filing.ecourts.gov.in is login-gated, CAPTCHA-
// protected web portal only, so this package has no client.ts/crypto.ts.

export type EfilingUserType = 'advocate' | 'litigant' | 'pleader' | 'clerk' | 'gov_auth' | 'insurance';

// Maps our user-facing user-type values to the login form's radio input ids
// (confirmed live against https://filing.ecourts.gov.in/ on 2026-10-14):
// user_advocate, user_person, user_pleader, user_clerk, user_gov_auth, user_insurance.
// Radio values posted as `user_type`: advocate=1, litigant=2, pleader=3, clerk=4,
// insurance=6 ("Institutional Litigant"), gov_auth=7 ("Court Nominated Officials").
export const EFILING_USER_TYPE_RADIO_ID: Record<EfilingUserType, string> = {
  advocate: 'user_advocate',
  litigant: 'user_person',
  pleader: 'user_pleader',
  clerk: 'user_clerk',
  gov_auth: 'user_gov_auth',
  insurance: 'user_insurance',
};

// States offered by the portal's #selState dropdown (captured live 2026-10-19).
// Values are eCourts CIS state codes - the same numbering services.ecourts
// uses - but the portal lists only these 30; states such as Arunachal,
// Mizoram or Nagaland exist on eCourts case status but not on eFiling 3.0.
export const EFILING_PORTAL_STATES: ReadonlyArray<{ code: number; name: string }> = [
  { code: 2, name: 'Andhra Pradesh' }, { code: 6, name: 'Assam' }, { code: 8, name: 'Bihar' },
  { code: 27, name: 'Chandigarh' }, { code: 18, name: 'Chhattisgarh' }, { code: 26, name: 'Delhi' },
  { code: 30, name: 'Goa' }, { code: 17, name: 'Gujarat' }, { code: 14, name: 'Haryana' },
  { code: 5, name: 'Himachal Pradesh' }, { code: 12, name: 'Jammu and Kashmir' }, { code: 7, name: 'Jharkhand' },
  { code: 3, name: 'Karnataka' }, { code: 4, name: 'Kerala' }, { code: 33, name: 'Ladakh' },
  { code: 23, name: 'Madhya Pradesh' }, { code: 1, name: 'Maharashtra' }, { code: 25, name: 'Manipur' },
  { code: 21, name: 'Meghalaya' }, { code: 11, name: 'Odisha' }, { code: 35, name: 'Puducherry' },
  { code: 22, name: 'Punjab' }, { code: 9, name: 'Rajasthan' }, { code: 24, name: 'Sikkim' },
  { code: 10, name: 'Tamil Nadu' }, { code: 29, name: 'Telangana' }, { code: 20, name: 'Tripura' },
  { code: 13, name: 'Uttar Pradesh' }, { code: 15, name: 'Uttarakhand' }, { code: 16, name: 'West Bengal' },
];

export const EFILING_PORTAL_STATE_CODES: ReadonlySet<number> = new Set(EFILING_PORTAL_STATES.map((s) => s.code));

/** Portal entry points for the steps only the advocate can do. Post-login
 *  routes aren't captured yet, so these land on the portal itself. */
export const EFILING_PORTAL_URL = 'https://filing.ecourts.gov.in/pdedev/';
export const EPAY_PORTAL_URL = 'https://pay.ecourts.gov.in/epay/';

export interface EfilingStateOption {
  value: string;
  label: string;
}

export interface EfilingCaseDetails {
  caseType: string;
  caseNumber?: string;
  caseYear?: string;
  description?: string;
}

// ---- Filing particulars (portal New Case wizard tabs 1-6) -------------------

export interface FilingAct {
  act: string;
  section: string;
}

/** Portal "MVC" tab (eFiling 3.0 manual §6.2.1.6). */
export interface MactDetails {
  /** "Item Number" on the MVC tab. */
  itemNo?: string | null;
  accidentDate?: string | null;
  accidentTime?: string | null;
  accidentPlace?: string | null;
  injuryType?: 'simple' | 'serious' | 'death' | 'other' | null;
  injuredName?: string | null;
  /** Where the police station is: the tab asks State / District / Taluka. */
  policeState?: string | null;
  policeDistrict?: string | null;
  policeTaluka?: string | null;
  policeStation?: string | null;
  /** "Other Police Station" checkbox: a station not in the portal's list. */
  otherPoliceStation?: boolean | null;
  firType?: string | null;
  firNo?: string | null;
  firYear?: number | null;
  vehicleType?: string | null;
  vehicleRegNo?: string | null;
  drivingLicenceNo?: string | null;
  licenceIssuingAuthority?: string | null;
  insurer?: string | null;
  compensationClaimedInr?: number | null;
}

export interface FilingParticulars {
  caseId: string;
  courtTier: 'DC' | 'HC' | null;
  stateCode: number | null;
  districtCode: number | null;
  courtCode: number | null;
  estCode: string | null;
  courtComplexCode: string | null;
  establishmentName: string | null;
  caseTypeCode: string | null;
  caseTypeName: string | null;
  isUrgent: boolean;
  /** High Court only: Civil / Criminal side, matter type, and bench. */
  hcSide: 'civil' | 'criminal' | null;
  hcMatterType: string | null;
  hcBench: string | null;
  causeOfAction: string | null;
  causeOfActionDate: string | null;
  disputePlace: string | null;
  subject: string | null;
  prayer: string | null;
  reliefParticulars: string | null;
  valuationInr: number | null;
  claimAmountInr: number | null;
  acts: FilingAct[];
  hideParty: boolean;
  hidePartyReason: string | null;
  localLanguage: string | null;
  plaintLocal: string | null;
  mact: MactDetails | null;
  /** Portal fields without a column of their own (migration 0090): Relief
   *  Sought, Subordinate Court, Dispute Arising Out Of, local-language case
   *  details. Keys: see PARTICULARS_EXTRA_KEYS. */
  extra: Record<string, string>;
  updatedAt: string | null;
}

/** case_filing_particulars.extra keys, named after the portal fields. */
export const PARTICULARS_EXTRA_KEYS = [
  // Initial Inputs > Case Types
  'reliefSought',
  // Initial Inputs > Subordinate Court (appeals)
  'subCourtDistrict', 'subCourtEstablishment', 'subCourtCaseType', 'subCourtCaseNo', 'subCourtCaseYear',
  'subCourtDisposalDate', 'subCourtCcAppliedDate', 'subCourtCcReadyDate',
  // Case Details > Dispute Arising Out Of
  'disputeState', 'disputeDistrict', 'disputeTaluka', 'disputeVillage',
  // Case Details > local-language block
  'causeOfActionLocal', 'prayerLocal', 'subjectLocal',
] as const;

export type PartySide = 'petitioner' | 'respondent';

export interface FilingParty {
  id: string;
  caseId: string;
  side: PartySide;
  position: number;
  /** The party this advocate appears for (portal Initial Inputs: "Party
   *  (client) Details"). Vakalat is executed for these parties. */
  isClient: boolean;
  isOrganization: boolean;
  name: string;
  relationType: 'S/o' | 'D/o' | 'W/o' | 'C/o' | null;
  relationName: string | null;
  gender: 'M' | 'F' | 'T' | null;
  age: number | null;
  dateOfBirth: string | null;
  occupation: string | null;
  address: string | null;
  district: string | null;
  state: string | null;
  pinCode: string | null;
  mobile: string | null;
  email: string | null;
  isMinor: boolean;
  guardianName: string | null;
  orgRepresentative: string | null;
  legalHeirOf: string | null;
  nameLocal: string | null;
  addressLocal: string | null;
  extra: Record<string, string>;
}

export interface CaseFact {
  id: string;
  caseId: string;
  position: number;
  factDate: string | null;
  factTime: string | null;
  description: string;
}

// ---- Filing lifecycle --------------------------------------------------------

export type FilingKind = 'new_case' | 'ia' | 'caveat' | 'misc_document' | 'deficit_court_fee';

// The lifecycle follows the eFiling 3.0 portal (user manual §4.2, §6.2-6.6):
//
//   draft / ready  prepared in DifAi (particulars, bundle)
//   efiled         entered on the portal - "eFile Case" (tab 7) issued the
//                  eFiling number; vakalat, pleadings, eSign, oath and fees are
//                  still being done on the portal ("Draft Pleadings")
//   submitted      final submit from Draft Pleadings with the GRN selected (for
//                  an IA: authenticated by advocate + litigant, which submits it)
//   objected / refiled / accepted   court scrutiny
//   registered     numbered by the court (new case: CNR -> eCourts sync)
export type FilingStatus =
  | 'draft' | 'ready' | 'efiled' | 'submitted' | 'objected' | 'refiled'
  | 'accepted' | 'registered' | 'rejected' | 'withdrawn';

/** Statuses the tracker watches: before the court, not yet registered. */
export const TRACKED_STATUSES: ReadonlyArray<FilingStatus> = ['submitted', 'objected', 'refiled', 'accepted'];

/** Steps only the advocate (or client) can do on the portal itself. */
export type PortalStepKey =
  | 'efile_case' | 'vakalat' | 'upload' | 'indexing' | 'esign' | 'oath' | 'court_fee' | 'final_submit'
  | 'ia_application' | 'ia_fee' | 'ia_auth_advocate' | 'ia_auth_litigant';
export type PortalStepState = 'pending' | 'done' | 'not_applicable';

export interface PortalStep {
  key: PortalStepKey;
  label: string;
  /** Where on the portal, in the manual's own menu names. */
  hint: string;
  /** Steps that can't be skipped (no "not needed"). */
  required?: boolean;
}

const STEP: Record<PortalStepKey, PortalStep> = {
  efile_case: { key: 'efile_case', label: 'Enter the case on the portal', required: true, hint: 'Case Filing > New Case Filing: fill tabs 1-6 from DifAi\'s particulars, then e-File > "eFile Case". Note the eFiling number it gives.' },
  vakalat: { key: 'vakalat', label: 'Vakalat', hint: 'Vakalat > Assign Partners to Case. The client then sends the offer by OTP (Offer to Advocate) and you accept by OTP (Accept Offer).' },
  upload: { key: 'upload', label: 'Upload pleadings', required: true, hint: 'Pleadings > Pleadings > Pleading Upload: choose the eFiling number, upload the DifAi bundle PDF.' },
  indexing: { key: 'indexing', label: 'Index the documents', hint: 'Pleadings > Indexing: add each document\'s page range. Copy them from the bundle index in DifAi.' },
  esign: { key: 'esign', label: 'eSign', hint: 'Pleadings > Pleading eSign: authorise signatories, then Aadhaar eSign (C-DAC) or OTP for each.' },
  oath: { key: 'oath', label: 'Record oath', hint: 'Pleadings > Record Your Oath: webcam video, where your court requires it.' },
  court_fee: { key: 'court_fee', label: 'Pay court fee', hint: 'e-Payments > Payments (or Court Fee Wallet): pay, then record the GRN in DifAi.' },
  final_submit: { key: 'final_submit', label: 'Final submit', required: true, hint: 'Dashboard > Draft Pleadings: select the GRN against the documents and press Submit.' },
  ia_application: { key: 'ia_application', label: 'Add the application', required: true, hint: 'Applications > Interlocutory Applications Filing: pick the case and application type, check preamble, prayer and fee, add the paragraphs, Submit.' },
  ia_fee: { key: 'ia_fee', label: 'Pay the IA fee', hint: 'Interlocutory Applications Filing > Pay Fees: pays from the court-fee wallet of that establishment.' },
  ia_auth_advocate: { key: 'ia_auth_advocate', label: 'Advocate authentication', required: true, hint: 'Interlocutory Applications Filing > Authentication: tick the application, "Authentication Pending" > OTP to your mobile.' },
  ia_auth_litigant: { key: 'ia_auth_litigant', label: 'Litigant authentication', required: true, hint: 'The litigant authenticates by OTP (Application Authentication in their login, or the OTP to their mobile on your screen). Once both are done the portal submits the IA.' },
};

/** Official step order per filing type. */
export const PORTAL_STEPS_BY_KIND: Record<FilingKind, ReadonlyArray<PortalStep>> = {
  new_case: [STEP.efile_case, STEP.vakalat, STEP.upload, STEP.indexing, STEP.esign, STEP.oath, STEP.court_fee, STEP.final_submit],
  // Documents into an existing case: Pleadings menu against the case, then
  // final submit from Draft Pleadings.
  misc_document: [STEP.upload, STEP.indexing, STEP.esign, STEP.oath, STEP.final_submit],
  deficit_court_fee: [STEP.court_fee, STEP.final_submit],
  ia: [STEP.ia_application, STEP.ia_fee, STEP.ia_auth_advocate, STEP.ia_auth_litigant],
  // Not in the eFiling 3.0 manual's menu; offered by some High Courts'
  // eFiling. Same shape as a new case.
  caveat: [STEP.efile_case, STEP.vakalat, STEP.upload, STEP.esign, STEP.court_fee, STEP.final_submit],
};

/** Steps that make up "entered on the portal" for each kind. */
export const EFILED_STEP: Record<FilingKind, PortalStepKey> = {
  new_case: 'efile_case',
  caveat: 'efile_case',
  ia: 'ia_application',
  misc_document: 'upload',
  deficit_court_fee: 'court_fee',
};

/** All step keys, for validation. */
export const ALL_STEP_KEYS = Object.keys(STEP) as PortalStepKey[];

/** @deprecated kept for older callers; the new-case list. */
export const PORTAL_STEPS = PORTAL_STEPS_BY_KIND.new_case;

export type TrackingStatus = 'idle' | 'searching' | 'matched' | 'ambiguous' | 'not_found' | 'error';

export interface CnrCandidateDto {
  cino: string;
  title: string;
  establishment: string | null;
  caseNo: string | null;
}

export interface EfilingFiling {
  id: string;
  caseId: string;
  caseTitle: string;
  kind: FilingKind;
  title: string;
  status: FilingStatus;
  efilingNo: string | null;
  /** When the case was entered on the portal (eFiling number issued). */
  efiledAt: string | null;
  submittedAt: string | null;
  courtFilingNo: string | null;
  courtFilingYear: number | null;
  registrationNo: string | null;
  cnr: string | null;
  registeredAt: string | null;
  objections: string | null;
  objectionsRaisedAt: string | null;
  objectionsCuredAt: string | null;
  steps: Partial<Record<PortalStepKey, PortalStepState>>;
  bundle: { pages: number | null; sizeBytes: number | null; builtAt: string } | null;
  tracking: {
    status: TrackingStatus;
    lastAttemptAt: string | null;
    lastError: string | null;
    candidates: CnrCandidateDto[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface FilingDocument {
  id: string;
  position: number;
  label: string;
  sourceKind: 'draft_render' | 'document';
  sourceId: string;
  pageCount: number | null;
  sizeBytes: number | null;
}

export interface FilingPayment {
  id: string;
  purpose: 'court_fee' | 'deficit_court_fee' | 'process_fee' | 'judicial_deposit' | 'other';
  amountInr: number;
  grn: string | null;
  paidOn: string | null;
  payerName: string | null;
  mode: 'epay' | 'wallet' | 'challan' | null;
  createdAt: string;
}

export interface FilingEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  source: 'advocate' | 'tracker';
  createdAt: string;
}

// ---- Readiness ---------------------------------------------------------------

export type ReadinessSection = 'initial' | 'parties' | 'facts' | 'case_details' | 'mact' | 'documents';

export interface ReadinessIssue {
  section: ReadinessSection;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ReadinessReport {
  ready: boolean;
  errors: number;
  warnings: number;
  issues: ReadinessIssue[];
}
