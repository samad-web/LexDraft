// eCourts API response shapes. Fields are intentionally loose (lots of
// `string | null` and unknown-key escape hatches) because the underlying
// PHP API returns numeric/string mix and skips fields when empty.

export type Court = 'DC' | 'HC';

export interface AppRelease {
  appReleaseObj: {
    release_id: number;
    version_no: string;
    release_date: string;
    release_url: string;
    note: string;
    release_url_ios: string;
  };
  version_compatible: string;
  token: string;
}

export interface State {
  state_code: number;
  state_name: string;
  nationalstate_code: string;
  bilingual: 'Y' | 'N';
  display: 'Y' | 'N';
  [k: string]: unknown;
}

export interface District {
  // districtWebService.php returns `dist_code`/`dist_name` (not the
  // `district_*` spelling the CNR-history payload uses). Verified against the
  // live DC backend — Kerala returns e.g. `{ dist_code: 2, dist_name: "Ernakulam" }`.
  dist_code: number;
  dist_name: string;
  display?: 'Y' | 'N';
  [k: string]: unknown;
}

export interface CourtEstablishment {
  est_code: string;
  court_name: string;
  state_code: number;
  district_code: number;
  [k: string]: unknown;
}

export interface CaseType {
  case_type: string;
  type_name: string;
  [k: string]: unknown;
}

export interface CauseListEntry {
  cino: string;
  case_number: string;
  purpose: string;
  todays_date: string;
  nextdate: string;
  judge_name: string;
  court_no: string;
  court_code: number;
  dist_code: number;
  state_code: number;
  businessStatus: string;
  [k: string]: unknown;
}

export interface CaseHistoryHearing {
  cino: string;
  case_number: string;
  purpose: string;
  judge_name: string;
  todays_date: string;
  todays_date1: string;
  nextdate: string;
  businessStatus: string;
  court_code: number;
  court_no: string;
  dist_code: number;
  state_code: number;
  showbusiness: 'Y' | 'N';
  [k: string]: unknown;
}

export interface CaseOrder {
  order_id: string;
  order_date1f: string;
  order_details: string;
  filename: string;
  caseno: string;
  cCode: number;
  appFlag: string;
  state_cd: number;
  dist_cd: number;
  court_code: number;
  bilingual_flag: string;
  [k: string]: unknown;
}

export interface ExtraParty {
  partyid: string;
  partyname: string;
  litigantStatus?: string;
  partyNameLegalHeirLitigantStatus?: string;
  advExtraAdvname?: string;
  [k: string]: unknown;
}

export interface CaseHistory {
  cino: string;
  case_no: string;
  filing_no: string;
  date_of_filing: string;
  dt_regis: string;
  date_first_list?: string;
  date_next_list?: string;
  date_last_list?: string;
  date_of_decision?: string;
  reg_no: number;
  reg_year: number;
  fil_no: number;
  fil_year: number;
  efilno?: string;
  efil_dt?: string;
  pet_name: string;
  pet_adv: string;
  res_name: string;
  res_adv: string;
  ex_pet_namelegal?: ExtraParty[] | null;
  ex_res_namelegal?: ExtraParty[] | null;
  petName?: string;
  resName?: string;
  petAdv?: string;
  resAdv?: string;
  fir_no: string;
  fir_year: number;
  police_st_code: number;
  fir_details?: string;
  purpose_name?: string;
  disp_name?: string;
  act?: Array<{ actCodeName: string; actSectionName: string }>;
  last_order?: CaseOrder | null;
  historyOfCaseHearing?: CaseHistoryHearing[];
  finalOrder?: CaseOrder[] | null;
  interimOrder?: CaseOrder[] | null;
  transfer?: Array<{ transfer_date: string; from_court: string; to_court: string }>;
  court_name: string;
  est_code: string;
  state_code: number;
  state_name: string;
  district_code: number;
  district_name: string;
  desgname: string;
  desgcode: number;
  jcode: number;
  court_code: number;
  version: string;
  [k: string]: unknown;
}

export interface CnrLookupResponse {
  history: CaseHistory;
  token: string;
}

// filingCaseHistory.php - a second, richer case-record shape keyed by the
// same CNR as caseHistoryWebService.php (see ecourts.service.ts's
// fetchFilingCaseHistory). Confirmed live to carry fields caseHistoryWebService
// does NOT: date_next_list/purpose_next (the "Business" next-hearing date),
// legal-heir flags, objection tracking, lower-court history, bilingual party
// names. Distinct shape from CaseHistory, not a strict superset - kept as its
// own type rather than merged in.
export interface FilingCaseHistory {
  cino: string;
  case_no: string;
  filing_no: string;
  date_of_filing: string;
  dt_regis: string;
  date_first_list?: string;
  date_next_list?: string;
  date_of_decision?: string | null;
  disp_nature?: number;
  purpose_next?: number;
  reg_no: number;
  reg_year: number;
  fil_no: number;
  fil_year: number;
  court_no: number;
  pet_name: string;
  lpet_name?: string;
  pet_adv?: string;
  res_name: string;
  lres_name?: string;
  res_adv?: string;
  pet_legal_heir?: 'Y' | 'N';
  res_legal_heir?: 'Y' | 'N';
  pet_status?: number;
  res_status?: number;
  fir_no?: string;
  fir_year?: string | number;
  police_st_code?: string;
  fir_details?: string | null;
  lower_court_code?: string;
  lower_court?: string;
  lower_court_dec_dt?: string;
  objection?: string | null;
  obj_redate?: string;
  reason_for_rej?: string | null;
  act?: Array<{ actCodeName: string; actSectionName: string }>;
  court_name: string;
  est_code: string;
  state_code: number;
  state_name: string;
  district_code: number;
  district_name: string;
  [k: string]: unknown;
}

export interface FilingCaseHistoryResponse {
  history: FilingCaseHistory;
  token: string;
}

// ia_show_business.php - Interim Application business/status detail.
// Confirmed live: a case with no IAs returns `{ history: [] }` (legitimate
// empty, not an error) - callers should treat [] the same way CaseHistory's
// historyOfCaseHearing treats an empty array.
export interface IaBusinessEntry {
  ia_no?: string;
  purpose?: string;
  judge_name?: string;
  todays_date?: string;
  nextdate?: string;
  businessStatus?: string;
  [k: string]: unknown;
}

export interface IaBusinessResponse {
  history: IaBusinessEntry[];
  token: string;
}

// s_show_app.php - Appellate case information (fetchAppellateInfo in the
// official app). Confirmed live: a case with no appellate history still
// returns a `writInfo` object with the heading populated and the rest of the
// fields null - that is the legitimate "no appellate activity" answer, not a
// missing-data error.
export interface AppellateInfo {
  heading: string;
  app_cs_no?: string | null;
  app_auth_desc?: string | null;
  app_aut?: string | null;
  dt_of_recp?: string;
  dt_of_oder?: string;
  order_brief?: string | null;
  dt_of_com?: string;
  [k: string]: unknown;
}

export interface AppellateInfoResponse {
  writInfo: AppellateInfo;
  token: string;
}

// courtNameWebService.php - judge/bench assignment within one specific
// court. NOT JSON-structured like every other endpoint - `courtNames` is a
// single '#'-delimited string, each entry further split on '~'/'^':
//   "{value}~{label}#{court_code}^{index}"
// e.g. "1~1-ALICIA  N.-IV Metropolitan Magistrate#6^1". Entry '0' is the
// placeholder "Select Court Name" option; entry 'D' is a disabled header
// showing the court's own name. Parsing lives in ecourts.service.ts
// (parseCourtNames) rather than here - this type documents the raw wire
// shape only.
export interface CourtNamesResponse {
  courtNames: string;
  token: string;
}

export interface JudgeBench {
  code: string;
  /** The court (bench) number - `court_no` for the app's Cause List. */
  courtNo?: string;
  judgeName: string;
  designation: string;
}

// Caveat-family reference data (separate endpoints from the plain
// state/district lists - see stateWebServiceCaveat.php/districtWebServiceCaveat.php
// in ecourts.service.ts for the param-shape differences confirmed live).
export interface CaveatState {
  state_id: string;
  state_name: string;
  [k: string]: unknown;
}

export interface CaveatDistrict {
  dist_code: string;
  dist_name: string;
  [k: string]: unknown;
}

export interface LowerCourtCaveatEntry {
  [k: string]: unknown;
}

// caveatCaseHistoryWebService.php - detail for one specific caveat, given
// its caveat_no (the field a caveat search result row carries - see
// searchCaveat's doc comment). Confirmed live: a non-existent caveat number
// still returns this full shape with every field null/placeholder, not an
// error - that's the legitimate "nothing on record" answer.
export interface CaveatHistory {
  caveatDetails: {
    caveat_number: string | null;
    cnr_number: string | null;
    subject: string | null;
    dt_filing: string | null;
    time_of_filing: string | null;
    matched_case_no: string | null;
    [k: string]: unknown;
  };
  caveatorDetails: { caveator_name: string | null; [k: string]: unknown };
  caveateeDetails: { caveatee_name: string | null; [k: string]: unknown };
  establishment_name: string | null;
  [k: string]: unknown;
}

export interface CaveatHistoryResponse {
  history: CaveatHistory;
  token: string;
}

// latlong.php - court-complex geolocation. Confirmed live: response body is
// wrapped in a literal JSON string (`"<hex_iv><base64>"`), unlike every
// other endpoint's bare wire format - see lib/ecourts/client.ts's rawCall
// for the unwrap fix. `court_complex` carries a trailing `<br />` from the
// source HTML - left as-is here, stripped at the point of display.
export interface CourtLocation {
  latitude: string;
  longitude: string;
  court_complex: string;
  map_url: string;
  [k: string]: unknown;
}

export interface EnvelopeWithToken<T> {
  token?: string;
  [k: string]: unknown;
  // payload key varies per endpoint (states / districts / cases / etc.)
  payload?: T;
}
