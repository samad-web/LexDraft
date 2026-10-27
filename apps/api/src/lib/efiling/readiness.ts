import {
  EFILING_PORTAL_STATE_CODES,
  type CaseFact,
  type FilingDocument,
  type FilingParticulars,
  type FilingParty,
  type ReadinessIssue,
  type ReadinessReport,
} from './types';

// =============================================================================
// Filing readiness: what the portal's New Case wizard (tabs 1-6, see
// docs/efiling-selector-capture-todo.md §3.1) would reject or leave blank,
// checked against what DifAI holds for the matter. Pure - no DB - so the
// same rules drive the UI checklist, the draft -> ready transition and tests.
//
// 'error'   the portal marks the field mandatory (red star) or the step
//           cannot be completed without it.
// 'warning' optional on the portal but expected by registries in practice,
//           or something the advocate should double-check.
// =============================================================================

/** Largest single upload the portal is documented to accept (legacy eFiling
 *  guide: "should not be more than 50 MB"). Not yet confirmed for 3.0. */
export const EFILING_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const MOBILE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_RE = /^\d{6}$/;

export function isMactCaseType(p: Pick<FilingParticulars, 'caseTypeName' | 'caseTypeCode'>): boolean {
  const s = `${p.caseTypeName ?? ''} ${p.caseTypeCode ?? ''}`;
  return /\bM\.?\s?A\.?\s?C\.?\s?(T|P|OP)?\b|\bMVC\b|\bM\.?\s?V\.?\s?O\.?\s?P\b|motor\s+(accident|vehicle)/i.test(s);
}

export interface ReadinessInput {
  particulars: FilingParticulars | null;
  parties: FilingParty[];
  facts: CaseFact[];
  documents: FilingDocument[];
  bundle: { sizeBytes: number | null } | null;
}

export function evaluateReadiness(input: ReadinessInput): ReadinessReport {
  const issues: ReadinessIssue[] = [];
  const err = (section: ReadinessIssue['section'], field: string, message: string) =>
    issues.push({ section, field, message, severity: 'error' });
  const warn = (section: ReadinessIssue['section'], field: string, message: string) =>
    issues.push({ section, field, message, severity: 'warning' });

  const p = input.particulars;

  // ---- Tab 1: Initial Inputs ------------------------------------------------
  if (!p) {
    err('initial', 'court', 'Choose the court this case will be filed in.');
  } else {
    if (!p.courtTier) err('initial', 'courtTier', 'Choose High Court or District Court.');
    if (p.stateCode == null) {
      err('initial', 'stateCode', 'Choose the state.');
    } else if (!EFILING_PORTAL_STATE_CODES.has(p.stateCode)) {
      err('initial', 'stateCode', 'This state is not on the eFiling 3.0 portal. File physically or through the state\'s own portal.');
    }
    if (p.courtTier === 'DC' && p.districtCode == null) err('initial', 'districtCode', 'Choose the district.');
    if (p.courtTier === 'DC' && !p.estCode && p.courtCode == null) {
      err('initial', 'estCode', 'Choose the court establishment.');
    }
    if (!p.caseTypeCode && !p.caseTypeName) err('initial', 'caseType', 'Choose the case type.');
    else if (!p.caseTypeCode) {
      warn('initial', 'caseType', 'Case type has no eCourts code. Pick it from the list so it matches the portal.');
    }
    if (p.courtTier === 'HC') {
      if (!p.hcSide) err('initial', 'hcSide', 'High Court: choose Civil or Criminal.');
      if (!p.hcBench?.trim()) err('initial', 'hcBench', 'High Court: choose the bench (Principal Seat or the bench you file at).');
      if (!p.hcMatterType?.trim()) warn('initial', 'hcMatterType', 'High Court: add the matter type the portal asks for.');
    }
  }
  // Initial Inputs also asks for the party you appear for.
  if (input.parties.length > 0 && !input.parties.some((x) => x.isClient)) {
    err('initial', 'client', 'Mark which party is your client (the portal\'s "Party (client) Details"). Vakalat is executed for them.');
  }

  // ---- Tab 2/3: Litigants + legal heirs -------------------------------------
  const petitioners = input.parties.filter((x) => x.side === 'petitioner');
  const respondents = input.parties.filter((x) => x.side === 'respondent');
  if (petitioners.length === 0) err('parties', 'petitioner', 'Add at least one petitioner / appellant / complainant.');
  if (respondents.length === 0) err('parties', 'respondent', 'Add at least one respondent / accused.');

  const ids = new Set(input.parties.map((x) => x.id));
  for (const party of input.parties) {
    const who = party.name || (party.side === 'petitioner' ? 'Petitioner' : 'Respondent');
    const f = (field: string) => `party:${party.id}:${field}`;
    if (!party.name.trim()) err('parties', f('name'), `${who}: name is required.`);
    if (!party.address?.trim()) err('parties', f('address'), `${who}: address is required.`);
    if (party.pinCode && !PIN_RE.test(party.pinCode)) err('parties', f('pinCode'), `${who}: PIN code must be 6 digits.`);
    if (party.mobile && !MOBILE_RE.test(party.mobile.replace(/^\+?91/, ''))) {
      err('parties', f('mobile'), `${who}: mobile must be a 10-digit Indian number.`);
    }
    if (party.email && !EMAIL_RE.test(party.email)) err('parties', f('email'), `${who}: email address looks wrong.`);

    if (party.isOrganization) {
      if (!party.orgRepresentative?.trim()) {
        warn('parties', f('orgRepresentative'), `${who}: name who represents the organisation (director, officer, authorised signatory).`);
      }
    } else {
      if (!party.gender) err('parties', f('gender'), `${who}: gender is required.`);
      if (party.age == null && !party.dateOfBirth) err('parties', f('age'), `${who}: age or date of birth is required.`);
      if (!party.relationType || !party.relationName?.trim()) {
        warn('parties', f('relation'), `${who}: add parentage (S/o, D/o, W/o, C/o).`);
      }
      const minor = party.isMinor || (party.age != null && party.age < 18);
      if (minor && !party.guardianName?.trim()) {
        err('parties', f('guardianName'), `${who}: a minor needs a guardian / next friend.`);
      }
    }
    if (party.side === 'petitioner' && !party.mobile) {
      warn('parties', f('mobile'), `${who}: add a mobile. The portal sends vakalat and authentication OTPs to it.`);
    }
    if (party.legalHeirOf && !ids.has(party.legalHeirOf)) {
      err('parties', f('legalHeirOf'), `${who}: is marked as legal heir of a party that no longer exists.`);
    }
  }

  // ---- Tab 4: Facts -----------------------------------------------------------
  if (input.facts.length === 0) {
    warn('facts', 'facts', 'Add the key dated facts. The portal has a Fact Details tab and registries expect it.');
  }
  for (const fact of input.facts) {
    if (!fact.factDate) warn('facts', `fact:${fact.id}:date`, `Fact "${truncate(fact.description)}" has no date.`);
  }

  // ---- Tab 5: Case details ----------------------------------------------------
  if (p) {
    if (!p.causeOfAction?.trim()) err('case_details', 'causeOfAction', 'Cause of action is required.');
    if (!p.causeOfActionDate) warn('case_details', 'causeOfActionDate', 'Add the date the cause of action arose (limitation runs from it).');
    if (!p.prayer?.trim()) err('case_details', 'prayer', 'Prayer / relief sought is required.');
    if (p.valuationInr == null && p.claimAmountInr == null) {
      warn('case_details', 'valuationInr', 'Add the valuation or claim amount. Court fee is computed from it.');
    }
    if (p.acts.length === 0) warn('case_details', 'acts', 'Add the Act(s) and section(s).');
    if (p.hideParty && !p.hidePartyReason?.trim()) {
      warn('case_details', 'hidePartyReason', 'Say why the party identity is hidden (POCSO, matrimonial, victim protection).');
    }
    if (p.localLanguage && !p.plaintLocal?.trim()) {
      warn('case_details', 'plaintLocal', `A local language (${p.localLanguage}) is set but the plaint text in it is empty.`);
    }
  }

  // ---- Tab 6: MVC (motor accident claims only) ------------------------------
  if (p && isMactCaseType(p)) {
    const m = p.mact ?? {};
    if (!m.accidentDate) err('mact', 'accidentDate', 'MACT: date of accident is required.');
    if (!m.accidentPlace?.trim()) err('mact', 'accidentPlace', 'MACT: place of accident is required.');
    if (!m.injuryType) err('mact', 'injuryType', 'MACT: type of injury (simple / serious / death) is required.');
    if (!m.vehicleRegNo?.trim()) err('mact', 'vehicleRegNo', 'MACT: offending vehicle registration number is required.');
    if (!m.policeStation?.trim() || !m.firNo?.trim()) warn('mact', 'fir', 'MACT: add the police station and FIR number.');
    if (m.policeStation?.trim() && (!m.policeState?.trim() || !m.policeDistrict?.trim())) {
      warn('mact', 'policeLocation', 'MACT: add the state, district and taluka of the police station. The MVC tab asks for them.');
    }
    if (!m.insurer?.trim()) warn('mact', 'insurer', 'MACT: add the insurance company.');
    if (m.compensationClaimedInr == null) err('mact', 'compensationClaimedInr', 'MACT: compensation claimed is required.');
  }

  // ---- Documents --------------------------------------------------------------
  if (input.documents.length === 0) {
    err('documents', 'documents', 'Add the pleading and documents to file.');
  } else if (!input.bundle) {
    warn('documents', 'bundle', 'Build the filing bundle (merged PDF with index) before uploading.');
  } else if (input.bundle.sizeBytes != null && input.bundle.sizeBytes > EFILING_MAX_UPLOAD_BYTES) {
    err('documents', 'bundle', `The bundle is ${mb(input.bundle.sizeBytes)} MB. The portal accepts up to ${mb(EFILING_MAX_UPLOAD_BYTES)} MB per file. Split it.`);
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  return { ready: errors === 0, errors, warnings: issues.length - errors, issues };
}

function truncate(s: string, n = 40): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
