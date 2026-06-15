import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient, api } from '@/lib/api';
import { triggerBlobDownload } from '@/lib/blob-download';

// =============================================================================
// useEcourts — TanStack Query bindings for the live eCourts gateway.
//
// Backend lives at /api/ecourts and is documented in
// apps/api/src/routes/ecourts.routes.ts. CNR lookup is the most-used endpoint
// (every other hook follows the same shape).
// =============================================================================

export type Court = 'DC' | 'HC';

// Field set covers the keys the response always carries. The PHP API also
// returns a long tail of optional numeric/string fields per case — they're
// preserved via the `[k: string]: unknown` escape hatch so callers can dig in.
export interface EcourtsHearing {
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

export interface EcourtsOrder {
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

export interface EcourtsExtraParty {
  partyid: string;
  partyname: string;
  partyNameLegalHeirLitigantStatus?: string;
  advExtraAdvname?: string;
  [k: string]: unknown;
}

export interface EcourtsCaseHistory {
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
  petName?: string;
  resName?: string;
  ex_pet_namelegal?: EcourtsExtraParty[] | null;
  ex_res_namelegal?: EcourtsExtraParty[] | null;
  fir_no: string;
  fir_year: number;
  police_st_code: number;
  fir_details?: string;
  purpose_name?: string;
  disp_name?: string;
  act?: Array<{ actCodeName: string; actSectionName: string }>;
  last_order?: EcourtsOrder | null;
  historyOfCaseHearing?: EcourtsHearing[];
  finalOrder?: EcourtsOrder[] | null;
  interimOrder?: EcourtsOrder[] | null;
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

export interface EcourtsState {
  state_code: number;
  state_name: string;
  nationalstate_code: string;
  display: 'Y' | 'N';
  [k: string]: unknown;
}

export interface EcourtsDistrict {
  state_code: number;
  district_code: number;
  district_name: string;
  [k: string]: unknown;
}

// 16-char CNR: 4 letters (state + district) + 12 alphanumeric (establishment
// can have letters too — e.g. TNCG**0B**0011172024 for Alandur JM). See
// memory/project-ecourts-api-reverse-engineering for the format.
const CNR_RE = /^[A-Za-z]{4}[A-Za-z0-9]{12}$/;

/** Live CNR lookup. Returns the full case history. `enabled` gates on a valid
 *  CNR shape so users can type without firing requests on every keystroke. */
export function useEcourtsCnr(cnr: string | null | undefined, court: Court = 'DC') {
  const cleaned = (cnr ?? '').trim().toUpperCase();
  const valid = CNR_RE.test(cleaned);
  return useQuery({
    queryKey: ['ecourts', 'cnr', cleaned, court],
    queryFn: () => api.get<{ history: EcourtsCaseHistory }>(`/ecourts/lookup/cnr/${cleaned}`, { court }),
    select: (r) => r.history,
    enabled: valid,
    // CNR data changes when a hearing happens — 5 minutes is enough freshness
    // for an interactive lookup screen, server already caches at the same TTL.
    staleTime: 5 * 60 * 1000,
  });
}

export function useEcourtsStates(court: Court = 'DC') {
  return useQuery({
    queryKey: ['ecourts', 'states', court],
    queryFn: () => api.get<{ items: EcourtsState[] }>('/ecourts/reference/states', { court }),
    select: (r) => r.items,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

interface DownloadOrderInput {
  cino: string;
  filename: string;
  /** eCourts code identifiers, surfaced on each order row (state_cd, dist_cd, court_code). */
  stateCd: number;
  distCd: number;
  courtCode: number;
  court?: Court;
}

/**
 * Download a single order / judgment PDF. The backend does the eCourts
 * 2-step token flow and streams the PDF; we read it as a Blob, parse the
 * server-supplied filename out of `Content-Disposition`, and trigger a
 * regular browser download.
 *
 * Stays a mutation rather than a query because each click is an intentional
 * user action and the upstream PDF token is one-shot — caching the response
 * would be wrong.
 */
export function useDownloadOrderPdf() {
  return useMutation({
    mutationFn: async (input: DownloadOrderInput) => {
      const res = await apiClient.post<Blob>('/api/ecourts/orders/pdf', input, {
        responseType: 'blob',
      });
      // Express writes the filename in Content-Disposition; fall back to a
      // CNR-derived name if the header gets stripped by a proxy.
      const cd = res.headers['content-disposition'] ?? '';
      const m = /filename="?([^";]+)"?/i.exec(cd);
      const fname = m?.[1] ?? `${input.cino}.pdf`;
      triggerBlobDownload(res.data, fname);
      return fname;
    },
  });
}

export function useEcourtsDistricts(stateCode: number | null | undefined, court: Court = 'DC') {
  return useQuery({
    queryKey: ['ecourts', 'districts', stateCode, court],
    queryFn: () => api.get<{ items: EcourtsDistrict[] }>(`/ecourts/reference/districts/${stateCode}`, { court }),
    select: (r) => r.items,
    enabled: typeof stateCode === 'number' && stateCode > 0,
    staleTime: 24 * 60 * 60 * 1000,
  });
}
