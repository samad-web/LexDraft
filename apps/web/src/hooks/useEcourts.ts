import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

// ---- Court orders by party, through the mobile API (no captcha) -------------

export interface OrdersByPartyInput {
  stateCode: number;
  distCode: number;
  courtCode: number;
  estCode: string;
  partyName: string;
  year: number;
  orderType: 'both' | 'finalorder' | 'interim';
  court?: Court;
}

export interface OrdersByPartyCase {
  cino: string;
  title: string;
  caseNo: string | null;
  establishment: string | null;
  interimOrders: EcourtsOrder[];
  finalOrders: EcourtsOrder[];
  error?: string;
}

export interface OrdersByPartyResult {
  casesFound: number;
  casesOpened: number;
  truncated: boolean;
  cases: OrdersByPartyCase[];
}

export function useEcourtsOrdersByParty() {
  return useMutation({
    mutationFn: (input: OrdersByPartyInput) => api.post<OrdersByPartyResult>('/ecourts/orders/by-party', input),
  });
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
  /** The case's current/most-recent business entry - same shape as a row in
   *  historyOfCaseHearing, but this is the live status (today's or the next
   *  scheduled business), not a past entry in the hearings table. */
  last_business_date?: EcourtsHearing | null;
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

// filingCaseHistory.php — a second, richer case-record shape keyed by the
// same CNR as EcourtsCaseHistory, confirmed to carry date_next_list/
// purpose_next (next-hearing-date) PLUS legal-heir flags/objection tracking/
// bilingual names that caseHistoryWebService.php doesn't return. See
// useEcourtsFilingHistory below — this is what powers next-date/status on
// SEARCH RESULTS (not just the opened-case detail view).
export interface EcourtsFilingHistory {
  cino: string;
  case_no: string;
  filing_no: string;
  date_of_filing: string;
  dt_regis: string;
  date_first_list?: string;
  date_next_list?: string;
  date_of_decision?: string | null;
  purpose_next?: number;
  pet_name: string;
  res_name: string;
  pet_legal_heir?: 'Y' | 'N';
  res_legal_heir?: 'Y' | 'N';
  court_name: string;
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
  // districtWebService.php returns `dist_code`/`dist_name` (not the
  // `district_*` spelling used elsewhere in the eCourts response shapes) —
  // verified live against the backend. Getting this wrong renders every
  // <option> with no value/label (see EcourtsView.tsx district picker).
  dist_code: number;
  dist_name: string;
  [k: string]: unknown;
}

// 16-char CNR: 4 letters (state + district) + 12 alphanumeric (establishment
// can have letters too — e.g. TNCG**0B**0011172024 for Alandur JM). See
// memory/project-ecourts-api-reverse-engineering for the format.
const CNR_RE = /^[A-Za-z]{4}[A-Za-z0-9]{12}$/;

/** Live CNR lookup. Returns the full case history. `enabled` gates on a valid
 *  CNR shape so users can type without firing requests on every keystroke. */
export interface StoredCaseMeta {
  /** When LexDraft last got this case from eCourts. */
  fetchedAt: string;
  /** Older than the server's freshness window - shown, but being refreshed. */
  stale: boolean;
  refreshing: boolean;
}

type CnrResponse =
  | { history: EcourtsCaseHistory; meta?: StoredCaseMeta; queued?: undefined }
  | { queued: true; message: string; history?: undefined; meta?: undefined };

/** Case by CNR, served from LexDraft's case store (instant when stored),
 *  refreshed in the background when stale. When eCourts is down and the case
 *  isn't stored yet, the server queues the fetch (202) and this hook keeps
 *  re-checking until it lands - the advocate also gets an in-app notification. */
export function useEcourtsCnr(cnr: string | null | undefined, court: Court = 'DC') {
  const cleaned = (cnr ?? '').trim().toUpperCase();
  const valid = CNR_RE.test(cleaned);
  const query = useQuery({
    queryKey: ['ecourts', 'cnr', cleaned, court],
    queryFn: () => api.get<CnrResponse>(`/ecourts/lookup/cnr/${cleaned}`, { court }),
    enabled: valid,
    staleTime: 5 * 60 * 1000,
    // Queued: check again every 20 s. Stale copy being refreshed: pick up the
    // fresh one shortly after.
    refetchInterval: (q) => {
      const d = q.state.data;
      if (d?.queued) return 20_000;
      if (d?.meta?.refreshing) return 12_000;
      return false;
    },
    // A 404 ("No case found for this CNR") is a well-formed, expected
    // answer from the backend for a syntactically valid but non-existent
    // CNR - retrying it just delays the "not found" state for no benefit
    // (unlike a 5xx/network failure, where TanStack Query's default retry
    // is actually useful).
    retry: (failureCount, err) => (err as { response?: { status?: number } })?.response?.status !== 404 && failureCount < 3,
  });
  // Surfaced separately from the generic `isError` so callers can route a
  // genuine "no record for this CNR" to a dedicated empty-state instead of
  // the same red/vermillion card used for transport/server failures (5xx,
  // network errors). err.response is the real AxiosError shape rejected by
  // the apiClient interceptor in lib/api.ts (untouched there for exactly
  // this kind of status-code branching).
  const isNotFound = (query.error as { response?: { status?: number } } | null)?.response?.status === 404;
  const raw = query.data;
  return {
    ...query,
    data: raw?.history,
    isNotFound,
    /** Set while eCourts is busy and the server is fetching in the background. */
    queued: raw?.queued ? raw.message : null,
    meta: raw?.meta ?? null,
  };
}

/**
 * Next-hearing-date + status for a single search result row, WITHOUT the
 * advocate opening the case first — this is what the official eCourts app
 * shows inline on search results (Next/Disposal Date + Pending/status badge)
 * that this portal previously only surfaced after a click-through. Disabled
 * until explicitly enabled by the caller (`enabled` param) — a results list
 * decides whether to auto-fetch per row (eager) or wait for a hover/click
 * (lazy), rather than this hook always firing on mount for every row.
 */
export function useEcourtsFilingHistory(cnr: string | null | undefined, court: Court = 'DC', enabled = true) {
  const cleaned = (cnr ?? '').trim().toUpperCase();
  const valid = CNR_RE.test(cleaned);
  return useQuery({
    queryKey: ['ecourts', 'filing-history', cleaned, court],
    queryFn: () => api.get<{ history: EcourtsFilingHistory }>(`/ecourts/lookup/cnr/${cleaned}/filing-history`, { court }),
    select: (r) => r.history,
    enabled: valid && enabled,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, err) => (err as { response?: { status?: number } })?.response?.status !== 404 && failureCount < 3,
  });
}

/**
 * Save an eCourts CNR lookup into the firm's matters. Creates the case row
 * from the fields the CNR history already gives us, then immediately syncs it
 * from eCourts so the hearings/orders/parties are folded in (rather than
 * duplicating that mapping here — the backend `sync-from-ecourts` is the single
 * source of that logic). Returns the created case id.
 *
 * Invalidates the cases list so the new matter appears without a manual reload.
 */
export function useAddEcourtsCaseToMatters() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ history, court }: { history: EcourtsCaseHistory; court: Court }) => {
      const title = `${history.petName || history.pet_name || 'Unknown'} v. ${history.resName || history.res_name || 'Unknown'}`;
      const disposed = Boolean(history.date_of_decision && history.disp_name);
      // Create the shell matter. `next` is left blank; the sync below fills the
      // real next-hearing date from the eCourts history.
      const created = await api.post<{ id: string }>('/cases', {
        cnr:    history.cino,
        title,
        court:  history.court_name || '',
        stage:  history.purpose_name || (disposed ? 'Disposed' : 'Filing'),
        client: '',
        // Backend `status` is a closed enum: Active | Pending | Closed |
        // Archived - 'Disposed' isn't a member and was rejected by Zod
        // validation (surfaced as a raw "Validation failed" toast). 'Closed'
        // is the existing convention for a disposed case elsewhere in the
        // app (see case-sync.service.ts's own eCourts sync).
        status: disposed ? 'Closed' : 'Active',
        next:   '',
        type:   'Other',
      });
      // Best-effort sync — if it fails the case still exists; the advocate can
      // retry from the Cases screen. We surface the sync error to the caller,
      // EXCEPT "eCourts is down" (503): creating the case already queued a
      // background link that retries until eCourts answers, so that isn't a
      // failure the advocate needs to act on.
      try {
        await api.post(`/cases/${created.id}/sync-from-ecourts`, { court });
      } catch (err) {
        if ((err as { response?: { status?: number } })?.response?.status !== 503) throw err;
      }
      return created.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cases'] });
      // sync-from-ecourts writes real rows into `hearings` (the case's next
      // listed date, plus its full past history) - without this the Calendar
      // and Dashboard stay on stale cached data until something else happens
      // to refetch them, so the hearing the advocate just added looks missing.
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['hearings'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
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

/** An order row's date. Final orders carry `order_date1f`; interim orders
 *  carry `order_date1` (verified live 2026-10-22, KLER010044852019). */
export function orderDateOf(o: EcourtsOrder | null | undefined): string {
  const row = (o ?? {}) as Record<string, unknown>;
  return String(row.order_date1f || row.order_date1 || row.order_date || '');
}

/**
 * A blob request's error body arrives as a Blob, so callers saw only
 * "Request failed with status code 400". Read the JSON error out of it and
 * rethrow in the usual `response.data.error` shape.
 */
async function blobErrorToJson(err: unknown): Promise<unknown> {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (!(data instanceof Blob)) return err;
  try {
    const body = JSON.parse(await data.text()) as { error?: string; details?: Array<{ message?: string }> };
    const message = body.details?.[0]?.message ?? body.error ?? 'eCourts could not provide this order.';
    return Object.assign(new Error(message), { response: { ...(err as { response: object }).response, data: { error: message } } });
  } catch {
    return err;
  }
}

interface DownloadOrderInput {
  cino: string;
  filename: string;
  /** eCourts code identifiers, surfaced on each order row (state_cd, dist_cd, court_code). */
  stateCd: number;
  distCd: number;
  courtCode: number;
  /** Also surfaced on each order row (caseno, cCode, bilingual_flag) - required by the backend. */
  caseNo: string;
  cCode: number;
  bilingualFlag?: string;
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
      }).catch(async (err: unknown) => { throw await blobErrorToJson(err); });
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

export interface EcourtsCourtComplex {
  complexCode: string;
  complexName: string;
  courtCodes: string[];
}

// Served from our own cache (captured once per district via a real browser
// session), not a live eCourts call - the live lookup is blocked for
// automated callers. Returns an empty list for a district we haven't
// captured yet; the UI falls back to a manual code field in that case.
export function useEcourtsCourtComplexes(
  stateCode: number | null | undefined,
  distCode: number | null | undefined,
  court: Court = 'DC',
) {
  return useQuery({
    queryKey: ['ecourts', 'court-complexes', stateCode, distCode, court],
    queryFn: () => api.get<{ items: EcourtsCourtComplex[] }>(`/ecourts/reference/court-complexes/${stateCode}/${distCode}`, { court }),
    select: (r) => r.items,
    enabled: typeof stateCode === 'number' && stateCode > 0 && typeof distCode === 'number' && distCode > 0,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

export interface EcourtsCourt {
  courtCode: string;
  courtName: string;
}

// Individual courts within a complex (e.g. "Munsiff Court, Chengannur" is
// one of several courts inside "Court Complex, Chengannur"). A case is filed
// at a specific court - selecting only the complex isn't enough to search
// correctly (verified live: only one court in a six-court complex had the
// matching case).
export function useEcourtsCourts(
  stateCode: number | null | undefined,
  distCode: number | null | undefined,
  complexCode: string | null | undefined,
  court: Court = 'DC',
) {
  return useQuery({
    queryKey: ['ecourts', 'courts', stateCode, distCode, complexCode, court],
    queryFn: () => api.get<{ items: EcourtsCourt[] }>(`/ecourts/reference/courts/${stateCode}/${distCode}/${complexCode}`, { court }),
    select: (r) => r.items,
    enabled: typeof stateCode === 'number' && stateCode > 0 && typeof distCode === 'number' && distCode > 0 && Boolean(complexCode),
    staleTime: 24 * 60 * 60 * 1000,
  });
}

/** One option from a court-scoped dropdown list (case types, acts, police
 *  stations). `code` is what the search endpoints expect. */
export interface EcourtsRefOption {
  code: string;
  name: string;
}

// Case types, acts and police stations are scoped to ONE court - eCourts
// needs the numeric court code, not just state/district (verified live; see
// ecourts.service.ts listCaseTypes). Disabled until a court is picked.
function useCourtScopedList(
  kind: 'case-types' | 'acts' | 'police-stations',
  stateCode: number | '' | null | undefined,
  distCode: number | '' | null | undefined,
  courtCode: number | string | null | undefined,
  court: Court,
) {
  const sc = typeof stateCode === 'number' ? stateCode : null;
  const dc = typeof distCode === 'number' ? distCode : null;
  // One court code, or a whole court complex as "1,2,3" (as the app sends).
  const raw = courtCode === null || courtCode === undefined ? '' : String(courtCode);
  const cc = /^\d+(,\d+)*$/.test(raw) && raw !== '0' ? raw : null;
  const ready = Boolean(sc && dc && cc);
  return useQuery({
    queryKey: ['ecourts', kind, sc, dc, cc, court],
    queryFn: () => api.get<{ items: EcourtsRefOption[] }>(`/ecourts/reference/${kind}/${sc}/${dc}/${cc}`, { court }),
    select: (r) => r.items,
    enabled: ready,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
}

export function useEcourtsCaseTypes(
  stateCode: number | '' | null | undefined,
  distCode: number | '' | null | undefined,
  courtCode: number | string | null | undefined,
  court: Court = 'DC',
) {
  return useCourtScopedList('case-types', stateCode, distCode, courtCode, court);
}

export function useEcourtsActs(
  stateCode: number | '' | null | undefined,
  distCode: number | '' | null | undefined,
  courtCode: number | string | null | undefined,
  court: Court = 'DC',
) {
  return useCourtScopedList('acts', stateCode, distCode, courtCode, court);
}

export function useEcourtsPoliceStations(
  stateCode: number | '' | null | undefined,
  distCode: number | '' | null | undefined,
  courtCode: number | string | null | undefined,
  court: Court = 'DC',
) {
  return useCourtScopedList('police-stations', stateCode, distCode, courtCode, court);
}

// ---------------------------------------------------------------------------
// Website-only searches (CAPTCHA solved by the advocate): search by case type,
// advocate Bar registration, and Court Orders by party / case no. / date.
// Results come back as plain-text rows (never eCourts HTML) plus the CNR of
// each row, which opens in the normal CNR view.
// ---------------------------------------------------------------------------

export type EcourtsWebSearchFields =
  | { kind: 'case-type'; caseTypeCode: string; caseTypeName?: string; year: number; status: 'Pending' | 'Disposed' }
  | { kind: 'advocate-bar'; barState: string; barCode: string; barYear: string; status: 'Pending' | 'Disposed' | 'Both' }
  | { kind: 'orders-party'; partyName: string; year: number; orderType: 'both' | 'finalorder' | 'interim' }
  | { kind: 'orders-case'; caseTypeCode: string; caseTypeName?: string; regNo: string; year: number; orderType: 'both' | 'finalorder' | 'interim' }
  | { kind: 'orders-date'; fromDate: string; toDate: string; orderType: 'both' | 'finalorder' | 'interim' }
  | { kind: 'advocate-name'; advocateName: string; status: 'Pending' | 'Disposed' | 'Both' }
  | { kind: 'advocate-causelist'; barState: string; barCode: string; barYear: string; date: string }
  | { kind: 'party-status'; partyName: string; year: number; status: 'Pending' | 'Disposed' | 'Both' }
  | { kind: 'act'; actCode: string; actName?: string; section?: string; status: 'Pending' | 'Disposed' }
  | { kind: 'orders-court'; orderType: 'both' | 'finalorder' | 'interim' }
  | { kind: 'cause-list'; date: string; listType: 'civ' | 'cri' };

/** Court / judge options a search needs picked, readable only inside the
 *  eCourts session (court-number orders, cause list). */
export interface EcourtsWebSearchChoice {
  label: string;
  options: Array<{ value: string; label: string }>;
}

export interface EcourtsWebSearchScope {
  stateCode: number;
  distCode: number;
  complexCode: string;
  courtCode: number;
}

export interface EcourtsWebSearchResult {
  headers: string[];
  rows: Array<{ cells: string[]; cino: string | null }>;
  text: string;
}

export type EcourtsWebSearchSubmit =
  | { status: 'ok'; result: EcourtsWebSearchResult }
  | { status: 'retry'; reason: string; captchaImageBase64: string };

export function useStartEcourtsWebSearch() {
  return useMutation({
    mutationFn: (body: { scope: EcourtsWebSearchScope; fields: EcourtsWebSearchFields }) =>
      api.post<{ sessionId: string; captchaImageBase64: string; choice?: EcourtsWebSearchChoice }>('/ecourts/live/web-search', body),
  });
}

export function useSubmitEcourtsWebSearch() {
  return useMutation({
    mutationFn: ({ sessionId, captchaCode, choice }: { sessionId: string; captchaCode: string; choice?: string }) =>
      api.post<EcourtsWebSearchSubmit>(`/ecourts/live/web-search/${sessionId}/captcha`, { captchaCode, ...(choice ? { choice } : {}) }),
  });
}

// ---- Process details (summons / warrants) - CAPTCHA, then an OTP sent to
// the process recipient. The final step downloads the document PDF.

export function useStartProcessDetails() {
  return useMutation({
    mutationFn: (body: { processId: string; email: string }) =>
      api.post<{ sessionId: string; captchaImageBase64: string }>('/ecourts/live/process', body),
  });
}

export type ProcessCaptchaResult =
  | { status: 'ok'; result: EcourtsWebSearchResult; recipient: { email: string | null; mobile: string | null } }
  | { status: 'retry'; reason: string; captchaImageBase64: string };

export function useSubmitProcessCaptcha() {
  return useMutation({
    mutationFn: ({ sessionId, captchaCode }: { sessionId: string; captchaCode: string }) =>
      api.post<ProcessCaptchaResult>(`/ecourts/live/process/${sessionId}/captcha`, { captchaCode }),
  });
}

export function useSendProcessOtp() {
  return useMutation({
    mutationFn: ({ sessionId, ...body }: { sessionId: string; name: string; mobile: string; email: string }) =>
      api.post<{ message: string }>(`/ecourts/live/process/${sessionId}/send-otp`, body),
  });
}

export function useVerifyProcessOtp() {
  return useMutation({
    mutationFn: async ({ sessionId, otp }: { sessionId: string; otp: string }) => {
      const res = await apiClient.post<Blob>(`/api/ecourts/live/process/${sessionId}/verify-otp`, { otp }, { responseType: 'blob' });
      const cd = res.headers['content-disposition'] ?? '';
      const fname = /filename="?([^";]+)"?/i.exec(cd)?.[1] ?? 'process.pdf';
      triggerBlobDownload(res.data, fname);
      return fname;
    },
  });
}

export function useRefreshEcourtsWebSearchCaptcha() {
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ captchaImageBase64: string }>(`/ecourts/live/web-search/${sessionId}/captcha/refresh`, {}),
  });
}

export type EcourtsLinkStatus = 'unlinked' | 'pending' | 'linked' | 'not_found' | 'error';

export interface EcourtsSyncStatus {
  lastRun: {
    slot: 'morning' | 'evening';
    runDate: string;
    attempt: number;
    status: 'running' | 'completed' | 'partial' | 'upstream_down' | 'failed';
    startedAt: string;
    finishedAt: string | null;
  } | null;
  retryPending: boolean;
  counts: { linked: number; pending: number; notFound: number; error: number; unlinked: number } | null;
  schedule: { timezone: string; times: string[]; retryEveryMinutes: number };
}

/** Health of the firm's eCourts connection - latest 09:00/19:00 run and how
 *  many matters are linked / waiting / not found. */
export function useEcourtsSyncStatus() {
  return useQuery({
    queryKey: ['ecourts', 'sync-status'],
    queryFn: () => api.get<EcourtsSyncStatus>('/ecourts/sync/status'),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

export interface EcourtsJudgeBench {
  code: string;
  /** Court (bench) number - what the app's Cause List sends as court_no. */
  courtNo?: string;
  judgeName: string;
  designation: string;
}

export interface EcourtsCourtCauseList {
  judgeName: string;
  designation: string;
  heading: string;
  rows: Array<Record<string, unknown>>;
  causeListUrl: string | null;
}

/** The app's Cause List: one court (bench), a date, Civil or Criminal. */
export function useEcourtsCourtCauseList() {
  return useMutation({
    mutationFn: (body: { stateCode: number; distCode: number; courtCode: number; courtNo: string; kind: 'civil' | 'criminal'; date: string; court?: Court }) =>
      api.post<EcourtsCourtCauseList>('/ecourts/cause-list/court', body),
  });
}

// courtNameWebService.php - a 4th cascade level below useEcourtsCourts: WHICH
// judge sits on a specific court (e.g. "Family Courts, Chennai" has one
// judge; "Metropolitan Magistrate Courts, Saidapet" has nine). Unlike
// useEcourtsCourtComplexes/useEcourtsCourts (our own DB cache), this is a
// LIVE eCourts call - found by re-auditing the full decompiled APK, see
// ecourts.service.ts's listJudgeBenches doc comment. Empty array is a
// legitimate answer (court has no named judges on record, or the live call
// is transiently unavailable) - callers should treat it the same way the
// courts cascade treats an empty courts list (fall back gracefully, don't
// block the search).
export function useEcourtsJudgeBenches(
  stateCode: number | null | undefined,
  distCode: number | null | undefined,
  courtCode: string | null | undefined,
  court: Court = 'DC',
  /** YYYY-MM-DD - High Courts list the benches sitting on a date. */
  date?: string,
) {
  // One court, or a whole complex as "1,2,3" (the app's Court Name list).
  const codes = courtCode && /^\d+(,\d+)*$/.test(courtCode) ? courtCode : null;
  const day = court === 'HC' ? date : undefined;
  return useQuery({
    queryKey: ['ecourts', 'judge-benches', stateCode, distCode, codes, court, day],
    queryFn: () => api.get<{ items: EcourtsJudgeBench[] }>(`/ecourts/reference/judge-benches/${stateCode}/${distCode}/${codes}`, day ? { court, date: day } : { court }),
    select: (r) => r.items,
    enabled: typeof stateCode === 'number' && stateCode > 0 && typeof distCode === 'number' && distCode > 0 && Boolean(codes),
    staleTime: 24 * 60 * 60 * 1000,
    // A transient/unavailable live call shouldn't retry aggressively and
    // block the rest of the search form - this is a nice-to-have enrichment,
    // not a required field.
    retry: 1,
  });
}

export interface EcourtsCourtLocation {
  latitude: string;
  longitude: string;
  court_complex: string;
  map_url: string;
  [k: string]: unknown;
}

// latlong.php - court-complex geolocation. Scoped to the COMPLEX (one
// building), not an individual court inside it. Fixed live this session: the
// response was previously indistinguishable from a genuine crypto failure
// because eCourts wraps this one endpoint's body in a literal JSON string,
// unlike every other endpoint's bare wire format - see
// apps/api/src/lib/ecourts/client.ts's rawCall for the unwrap fix.
export function useEcourtsCourtLocation(
  stateCode: number | '' | null | undefined,
  distCode: number | '' | null | undefined,
  complexCode: string | null | undefined,
  court: Court = 'DC',
) {
  const sc = typeof stateCode === 'number' ? stateCode : null;
  const dc = typeof distCode === 'number' ? distCode : null;
  return useQuery({
    queryKey: ['ecourts', 'court-location', sc, dc, complexCode, court],
    queryFn: () => api.get<{ location: EcourtsCourtLocation }>(`/ecourts/reference/location/${sc}/${dc}/${complexCode}`, { court }),
    select: (r) => r.location,
    enabled: Boolean(sc && dc && complexCode),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
}

export interface EcourtsBusinessNote {
  hearingDate: string;
  businessText: string;
  updatedAt: string;
}

// eCourts' free-text "Business" narrative (Daily Status page) is CAPTCHA-
// gated on every path on the real eCourts site - there's no way to fetch it
// programmatically. The advocate reads it there (via the "Open Daily Status"
// link next to each hearing) and pastes it in once; these two hooks persist
// it per (cino, hearing date) so it shows up in LexDraft from then on.
export function useEcourtsBusinessNotes(cino: string | null | undefined) {
  return useQuery({
    queryKey: ['ecourts', 'business-notes', cino],
    queryFn: () => api.get<{ items: EcourtsBusinessNote[] }>(`/ecourts/business-notes/${cino}`),
    select: (r) => r.items,
    enabled: Boolean(cino),
    staleTime: 60 * 1000,
  });
}

export function useSaveEcourtsBusinessNote(cino: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hearingDate, businessText }: { hearingDate: string; businessText: string }) =>
      api.put<{ note: EcourtsBusinessNote }>(`/ecourts/business-notes/${cino}`, { hearingDate, businessText }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ecourts', 'business-notes', cino] });
    },
  });
}

// ---------------------------------------------------------------------------
// Court-scoped search — case number / party / advocate / FIR / filing number /
// act, plus cause list and caveat search. All call the real /api/ecourts
// search endpoints directly (apps/api/src/routes/ecourts.routes.ts) - nothing
// here opens an external tab. State and district lookups (above) are reliable;
// the establishment/court-code picker they feed into is a known-fragile link
// on eCourts' side, so every mutation below can fail with a clear error the
// UI surfaces honestly rather than pretending success.
// ---------------------------------------------------------------------------

export interface EcourtsCourtScope {
  stateCode: number;
  distCode: number;
  courtCode: number;
  // REQUIRED. Without it eCourts searches zero establishments and returns
  // `{"no_of_establishments":0}` - which reads exactly like a real "no
  // matches" result but isn't one (verified live).
  estCode: string;
  /** The whole Court Complex as the eCourts app searches it: "1,2,3". */
  courtCodes?: string;
}

export function useEcourtsSearchCaseNumber() {
  return useMutation({
    mutationFn: (body: EcourtsCourtScope & { caseType: string | number; regNo: string | number; year: number; court?: Court }) =>
      api.post<unknown>('/ecourts/search/case-number', body),
  });
}

// ---- eCourts app services, no captcha (verified live 2026-10-22) ----------

export function useEcourtsSearchCaseType() {
  return useMutation({
    mutationFn: (body: { stateCode: number; distCode: number; courtCode: number; courtCodes?: string; caseType: string | number; year: number; status: 'Pending' | 'Disposed'; court?: Court }) =>
      api.post<unknown>('/ecourts/search/case-type', body),
  });
}

/** Advocate's Cause List by advocate name (date as dd-mm-yyyy). */
export function useEcourtsAdvocateCauseList() {
  return useMutation({
    mutationFn: (body: { stateCode: number; distCode: number; courtCode: number; courtCodes?: string; advocateName: string; date: string; court?: Court }) =>
      api.post<unknown>('/ecourts/cause-list/advocate', body),
  });
}

export interface EcourtsPreTrialResult {
  establishments: Array<{
    name: string;
    courtCode: string;
    total: number;
    rows: Array<Record<string, unknown>>;
    orders: Array<Record<string, unknown>>;
  }>;
}

/** Pre Trial Application (Remand / Bail) by police station - no captcha. */
export function useEcourtsPreTrialSearch() {
  return useMutation({
    mutationFn: (body: {
      stateCode: number; distCode: number; courtCode: number; courtCodes?: string;
      applicationType: 'R' | 'B' | 'A'; policeStCode: number; firType: '0' | '1' | '2' | '3';
      firNumber?: string; year?: number; court?: Court;
    }) => api.post<EcourtsPreTrialResult>('/ecourts/pretrial/search', body),
  });
}

export function useDownloadPreTrialOrder() {
  return useMutation({
    mutationFn: async (input: { stateCode: number; distCode: number; courtCode: number; orderYr: string; orderId: string; crno: string }) => {
      const res = await apiClient.post<Blob>('/api/ecourts/pretrial/order-pdf', input, { responseType: 'blob' });
      const cd = res.headers['content-disposition'] ?? '';
      const fname = /filename="?([^";]+)"?/i.exec(cd)?.[1] ?? `pretrial-order-${input.orderId}.pdf`;
      triggerBlobDownload(res.data, fname);
      return fname;
    },
  });
}

export interface EcourtsBusiness {
  rows: Array<{ title: string; value: string }>;
  details: Record<string, unknown> | null;
}

/** View Business / Daily Status for one hearing row - no captcha. */
export function useEcourtsBusiness(row: EcourtsHearing | null | undefined, court: Court = 'DC') {
  const date = row ? String(row.todays_date1 || row.todays_date || '') : '';
  return useQuery({
    queryKey: ['ecourts', 'business', row?.cino, date, court],
    queryFn: () => api.post<EcourtsBusiness>('/ecourts/business', {
      cino: row!.cino,
      stateCode: Number(row!.state_code),
      distCode: Number(row!.dist_code),
      courtCode: Number(row!.court_code),
      caseNumber: String(row!.case_number ?? ''),
      courtNo: String(row!.court_no ?? ''),
      businessDate: date,
      nextDate: String((row as unknown as { n_dt?: string }).n_dt ?? ''),
      disposalFlag: String(row!.businessStatus ?? ''),
      court,
    }),
    enabled: Boolean(row?.cino && /^\d{2}-\d{2}-\d{4}$/.test(date) && row?.case_number),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

export function useEcourtsSearchParty() {
  return useMutation({
    mutationFn: (body: EcourtsCourtScope & { partyName: string; year: number; stage?: 'P' | 'D' | 'B'; court?: Court }) =>
      api.post<unknown>('/ecourts/search/party', body),
  });
}

export function useEcourtsSearchAdvocate() {
  return useMutation({
    mutationFn: (body: EcourtsCourtScope & { advocateName: string; year: number; stage?: 'P' | 'D' | 'B'; court?: Court }) =>
      api.post<unknown>('/ecourts/search/advocate', body),
  });
}

export function useEcourtsSearchFir() {
  return useMutation({
    mutationFn: (body: EcourtsCourtScope & { policeStCode: number; firNo: string; firYear: number; court?: Court }) =>
      api.post<unknown>('/ecourts/search/fir', body),
  });
}

export function useEcourtsSearchFilingNumber() {
  return useMutation({
    mutationFn: (body: EcourtsCourtScope & { filingNo: string; filingYear: number; court?: Court }) =>
      api.post<unknown>('/ecourts/search/filing-number', body),
  });
}

// KNOWN BROKEN - confirmed via full Hermes bytecode decompile + live testing
// against two different establishments (2026-10): searchByActWebService.php
// unconditionally rejects every request with error_ERROR_actcode1 regardless
// of field names/values tried, including shapes that exactly mirror other
// confirmed-working endpoints. The official eCourts app's own "Search by
// Act" screen appears non-functional against the live backend. Do not treat
// a `status:"N"` response as "no matching cases" - see ecourts.service.ts's
// searchByAct for the full investigation notes.
export function useEcourtsSearchAct() {
  return useMutation({
    mutationFn: (body: EcourtsCourtScope & { actCode: string | number; section?: string; year?: number; court?: Court }) =>
      api.post<unknown>('/ecourts/search/act', body),
  });
}

export function useEcourtsCauseList() {
  return useMutation({
    mutationFn: (body: EcourtsCourtScope & { date: string; court?: Court }) =>
      api.post<{ items: EcourtsCauseListEntry[] }>('/ecourts/cause-list', body),
  });
}

export interface EcourtsCauseListEntry {
  case_no?: string;
  petparty_name?: string;
  resparty_name?: string;
  court_no?: string;
  [k: string]: unknown;
}

export function useEcourtsCaveatSearch() {
  return useMutation({
    mutationFn: (body: EcourtsCourtScope & { caveatorName?: string; caveateeName?: string; searchBy?: 'Caveator' | 'Caveatee'; court?: Court }) =>
      api.post<unknown>('/ecourts/caveat/search', body),
  });
}

// ---------------------------------------------------------------------------
// Interim Application business + Appellate info - 2 of the 6 endpoints found
// by re-auditing the full decompiled APK (see ecourts.service.ts). Both
// render in CaseCard's detail view, below the orders/transfers sections.
// ---------------------------------------------------------------------------

export interface EcourtsIaBusinessEntry {
  ia_no?: string;
  purpose?: string;
  judge_name?: string;
  todays_date?: string;
  nextdate?: string;
  businessStatus?: string;
  [k: string]: unknown;
}

/** A case with no interim applications returns a legitimate empty array
 *  (verified live) - render nothing, not an error, in that case. */
export function useEcourtsIaBusiness(cnr: string | null | undefined, court: Court = 'DC') {
  const cleaned = (cnr ?? '').trim().toUpperCase();
  const valid = CNR_RE.test(cleaned);
  return useQuery({
    queryKey: ['ecourts', 'ia-business', cleaned, court],
    queryFn: () => api.get<{ items: EcourtsIaBusinessEntry[] }>(`/ecourts/lookup/cnr/${cleaned}/ia-business`, { court }),
    select: (r) => r.items,
    enabled: valid,
    staleTime: 5 * 60 * 1000,
  });
}

export interface EcourtsAppellateInfo {
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

/** POST-shaped like useEcourtsCaveatSearch (the backend route needs a body,
 *  not just a CNR) - callers trigger it once per case via a mount effect
 *  rather than this auto-querying, since the scope fields (court_code etc.)
 *  come from the already-loaded case history, not from user input. */
export function useEcourtsAppellateInfo() {
  return useMutation({
    mutationFn: (body: { stateCode: number; distCode: number; courtCode: number; caseNumber1: string; appCsNo: string; court?: Court }) =>
      api.post<{ writInfo: EcourtsAppellateInfo }>('/ecourts/appellate-info', body),
  });
}

/** Whether a caveat exists at a LOWER court for the same matter - a 6th
 *  endpoint found by re-auditing the full decompiled APK. Empty array is a
 *  legitimate "no lower-court caveat on record" answer, not an error. */
export function useEcourtsLowerCourtCaveat(
  stateCode: number | '' | null | undefined,
  distCode: number | '' | null | undefined,
  courtCode: number | null | undefined,
  court: Court = 'DC',
) {
  const sc = typeof stateCode === 'number' ? stateCode : null;
  const dc = typeof distCode === 'number' ? distCode : null;
  return useQuery({
    queryKey: ['ecourts', 'lower-court-caveat', sc, dc, courtCode, court],
    queryFn: () => api.get<{ items: Record<string, unknown>[] }>(`/ecourts/reference/caveat/lower-court/${sc}/${dc}/${courtCode}`, { court }),
    select: (r) => r.items,
    enabled: Boolean(sc && dc && typeof courtCode === 'number'),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export interface EcourtsCaveatHistory {
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

/** Detail for one specific caveat (parties, subject, filing date), given its
 *  caveat_no - the field every caveat search result row carries. POST-shaped
 *  like useEcourtsAppellateInfo (the scope fields come from the search form's
 *  already-known court, not re-collected from the user). */
export function useEcourtsCaveatHistory() {
  return useMutation({
    mutationFn: (body: { stateCode: number; distCode: number; courtCode: number; caveatNumber: string; court?: Court }) =>
      api.post<{ history: EcourtsCaveatHistory }>('/ecourts/caveat/history', body),
  });
}

// ---------------------------------------------------------------------------
// CNR-direct live lookup - the path used inline on search results. Party
// Name, Advocate, Case Number etc. (the fast mobile API) all return a
// `cino` per case already; this fetches that one case's live Business text
// directly by CNR, no state/district/complex picking needed (the CNR
// already encodes the court). One captcha per case looked up this way.
// ---------------------------------------------------------------------------

export function useStartCnrLiveSession() {
  return useMutation({
    mutationFn: () => api.post<{ sessionId: string }>('/ecourts/live/cnr-session'),
  });
}

// sessionId is a mutation argument (not bound when the hook is created) -
// the caller typically only has the session id *after* useStartCnrLiveSession
// resolves, in the same handler that then opens the lookup, so there's no
// stable sessionId to close over at hook-creation time.
// The backend may transparently restart the session on a page crash (~1 in
// 4 fresh eCourts sessions observed live) and return a DIFFERENT sessionId
// than the one sent - the caller must use the returned id for every
// subsequent call, not the one it passed in.
export function useOpenLiveCnrLookup() {
  return useMutation({
    mutationFn: ({ sessionId, cino }: { sessionId: string; cino: string }) =>
      api.post<{ captchaImageBase64: string; sessionId: string }>(`/ecourts/live/session/${sessionId}/cnr`, { cino }),
  });
}

export function useRefreshCnrCaptcha() {
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ captchaImageBase64: string }>(`/ecourts/live/session/${sessionId}/cnr/captcha/refresh`),
  });
}

export type EcourtsCnrCaptchaResult =
  | { historyHtml: string }
  | { retry: true; captchaImageBase64: string; reason: string };

// cino is required, not re-derived server-side from the page - see
// submitCnrCaptcha's doc comment in ecourts-live.service.ts: reading #cino
// from the DOM after a wrong-captcha error is unreliable, which caused a
// SECOND wrong-captcha attempt to fail with eCourts' own "Enter 16 digit
// CNR number" instead of a captcha error.
export function useSubmitCnrCaptcha() {
  return useMutation({
    mutationFn: ({ sessionId, captchaCode, cino }: { sessionId: string; captchaCode: string; cino: string }) =>
      api.post<EcourtsCnrCaptchaResult>(`/ecourts/live/session/${sessionId}/cnr/captcha`, { captchaCode, cino }),
  });
}
