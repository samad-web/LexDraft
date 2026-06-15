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
  state_code: number;
  district_code: number;
  district_name: string;
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

export interface EnvelopeWithToken<T> {
  token?: string;
  [k: string]: unknown;
  // payload key varies per endpoint (states / districts / cases / etc.)
  payload?: T;
}
