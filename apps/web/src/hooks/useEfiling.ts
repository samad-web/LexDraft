import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiClient } from '@/lib/api';

// =============================================================================
// useEfiling — TanStack Query bindings for the live eFiling gateway
// (filing.ecourts.gov.in). Backend lives at /api/efiling, documented in
// apps/api/src/routes/efiling.routes.ts. Mirrors useEcourts.ts's CNR-live
// session hooks exactly (same request/response shapes, same "sessionId may
// change on retry" caveat), with a login step added before the captcha step.
//
// SCOPE: login + CAPTCHA are real. Filing/upload return a 501 from the API
// until a real advocate login has been used to capture the post-login
// form's selectors — see efiling-live.service.ts's file header.
// =============================================================================

export type EfilingUserType = 'advocate' | 'litigant' | 'pleader' | 'clerk' | 'gov_auth' | 'insurance';

export function useStartEfilingSession() {
  return useMutation({
    mutationFn: ({ state, userType }: { state: string; userType: EfilingUserType }) =>
      api.post<{ sessionId: string }>('/efiling/live/session', { state, userType }),
  });
}

// The backend may transparently restart the session on a page crash (same
// behaviour as the eCourts CNR flow) and return a different sessionId than
// the one sent — always use the id the response hands back for subsequent
// calls, not the one passed in.
export function useSubmitEfilingCredentials() {
  return useMutation({
    mutationFn: ({ sessionId, username, password }: { sessionId: string; username: string; password: string }) =>
      api.post<{ captchaImageBase64: string; sessionId: string }>(`/efiling/live/session/${sessionId}/login`, { username, password }),
  });
}

export function useRefreshEfilingCaptcha() {
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ captchaImageBase64: string }>(`/efiling/live/session/${sessionId}/login/captcha/refresh`),
  });
}

export type EfilingLoginCaptchaResult =
  | { status: 'authenticated' }
  | { retry: true; captchaImageBase64: string; reason: string }
  | { duplicateLogin: true; captchaImageBase64: string; reason: string };

export function useSubmitEfilingLoginCaptcha() {
  return useMutation({
    mutationFn: ({ sessionId, captchaCode }: { sessionId: string; captchaCode: string }) =>
      api.post<EfilingLoginCaptchaResult>(`/efiling/live/session/${sessionId}/login/captcha`, { captchaCode }),
  });
}

// The advocate is already logged in elsewhere (eCourts allows only one
// active session per account) — this confirms the portal's own "logout
// other sessions" prompt. It re-collects the password (a separate form on
// the portal, not reused from the first login screen) plus a fresh captcha
// for that form specifically.
export type EfilingDuplicateLoginResult =
  | { status: 'authenticated' }
  | { retry: true; captchaImageBase64: string; reason: string };

export function useConfirmDuplicateEfilingLogin() {
  return useMutation({
    mutationFn: ({ sessionId, password, captchaCode }: { sessionId: string; password: string; captchaCode: string }) =>
      api.post<EfilingDuplicateLoginResult>(`/efiling/live/session/${sessionId}/login/duplicate`, { password, captchaCode }),
  });
}

export interface EfilingSessionStatus { sessionId: string; authenticated: boolean; idleMinutesLeft: number }

/** Keep-alive for the connected portal session; 404 means it has ended. */
export function useEfilingSessionStatus(sessionId: string | null) {
  return useQuery({
    queryKey: ['efiling', 'live', sessionId],
    queryFn: () => api.get<EfilingSessionStatus>(`/efiling/live/session/${sessionId}`),
    enabled: !!sessionId,
    refetchInterval: 2 * 60 * 1000,
    refetchIntervalInBackground: true,
    retry: false,
  });
}

export interface PortalSnapshot {
  url: string;
  title: string;
  headings: string[];
  links: Array<{ text: string; href: string }>;
  counts: Record<string, number>;
  fields: Array<{ tag: string; type: string; id: string; name: string; label: string; text: string; required: boolean; section: string; options?: string[] }>;
}

/** One of the advocate's own portal pages, read over their session (read-only). */
export function usePortalPage(sessionId: string | null, what: 'dashboard' | 'new_case', enabled = true) {
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'read', what],
    queryFn: () => api.get<PortalSnapshot>(`/efiling/live/session/${sessionId}/read`, { what }),
    enabled: !!sessionId && enabled,
    staleTime: 60 * 1000,
    retry: false,
  });
}

export interface PortalList {
  key: 'draft_cases' | 'filed_cases' | 'draft_pleadings' | 'completed_pleadings' | 'draft_ias' | 'completed_ias' | 'objections' | 'my_cases';
  label: string;
  total: number | null;
  headers: string[];
  rows: Array<{ group: string } | { cells: string[] }>;
  error: string | null;
}

/** The advocate's own portal dashboard lists, read over their session. */
export function usePortalLists(sessionId: string | null) {
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'lists'],
    queryFn: () => api.get<{ items: PortalList[] }>(`/efiling/live/session/${sessionId}/lists`),
    enabled: !!sessionId,
    staleTime: 60 * 1000,
    retry: false,
  });
}

export interface PortalTabReport {
  tab: 'initial' | 'litigant' | 'facts' | 'case_details' | 'mvc';
  label: string;
  status: 'done' | 'partial' | 'failed' | 'skipped';
  filled: string[];
  missing: string[];
  portal: string[];
}

/** Fill New Case Filing tabs 1-6 on the real portal (saved there as a draft). */
export function useFillOnPortal(filingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ pdeNo: string | null; tabs: PortalTabReport[] }>(`/efiling/live/session/${sessionId}/filings/${filingId}/fill`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['efiling'] }); },
  });
}

/** "eFile Case" on the real portal - irreversible; the caller confirms first. */
export function useEfileOnPortal(filingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ ok: boolean; pdeNo: string | null; portal: string[]; errorTabs: string[] }>(`/efiling/live/session/${sessionId}/filings/${filingId}/efile`, { confirmed: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['efiling'] }); },
  });
}

/** Upload the filing bundle as a pleading on the real portal (Pleading Upload). */
export function useUploadPleadingOnPortal(filingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ ok: boolean; pdeNo: string; title: string; pleadingNumber: string | null; portal: string[] }>(`/efiling/live/session/${sessionId}/filings/${filingId}/upload-pleading`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['efiling'] }); },
  });
}

/** Final submission on the real portal (Draft Pleadings > GRN > Submit). Irreversible. */
export function useSubmitOnPortal(filingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ ok: boolean; grn: string; portal: string[] }>(`/efiling/live/session/${sessionId}/filings/${filingId}/submit`, { confirmed: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['efiling'] }); },
  });
}

export interface PortalDashboardView {
  counts: Partial<Record<PortalList['key'], number>>;
  /** The portal's Calendar: month shown (1-12) and the case count badge per day. */
  calendar?: { month: number | null; year: number | null; days: Record<string, number> };
  /** "Cases Listed Today - dd-mm-yyyy" as the portal shows it. */
  today?: { title: string; table: Pick<PortalList, 'headers' | 'rows'> | null; text: string };
}

/** The portal's own dashboard: tile numbers, calendar badges and today's listed cases (one quick read). */
export function usePortalCounts(sessionId: string | null) {
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'counts'],
    queryFn: () => api.get<PortalDashboardView>(`/efiling/live/session/${sessionId}/counts`),
    enabled: !!sessionId,
    staleTime: 60 * 1000,
    retry: false,
  });
}

/** One portal dashboard list, read when its tile is opened. */
export function usePortalList(sessionId: string | null, key: PortalList['key'] | null, ready = true) {
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'list', key],
    queryFn: () => api.get<PortalList>(`/efiling/live/session/${sessionId}/lists/${key}`),
    // The portal session does one step at a time: wait for the tile numbers.
    enabled: !!sessionId && !!key && ready,
    staleTime: 60 * 1000,
    // "Still working on your last eFiling step" (409): try again shortly.
    retry: (n, err) => n < 4 && ((err as { response?: { status?: number }; status?: number })?.response?.status ?? (err as { status?: number })?.status) === 409,
    retryDelay: 1500,
  });
}

export function useEndEfilingSession() {
  return useMutation({
    mutationFn: (sessionId: string) => api.post<{ ok: true }>(`/efiling/live/session/${sessionId}/end`),
  });
}

// =============================================================================
// Filing preparation + tracking. Shapes mirror apps/api/src/lib/efiling/types.ts.
// =============================================================================

export interface PortalState { code: number; name: string }

/** The 31 states the eFiling 3.0 portal offers (a subset of eCourts'). */
export function useEfilingPortalStates() {
  return useQuery({
    queryKey: ['efiling', 'portal-states'],
    queryFn: () => api.get<{ items: PortalState[] }>('/efiling/portal/states'),
    select: (r) => r.items,
    staleTime: Infinity,
  });
}

export type PortalStepKey =
  | 'efile_case' | 'vakalat' | 'upload' | 'indexing' | 'esign' | 'oath' | 'court_fee' | 'final_submit'
  | 'ia_application' | 'ia_fee' | 'ia_auth_advocate' | 'ia_auth_litigant';
export type PortalStepState = 'pending' | 'done' | 'not_applicable';

export interface PortalStep { key: PortalStepKey; label: string; hint: string; required?: boolean }

/** The official portal steps, in order, for one kind of filing. */
export function useEfilingPortalSteps(kind: FilingKind = 'new_case') {
  return useQuery({
    queryKey: ['efiling', 'portal-steps', kind],
    queryFn: () => api.get<{ items: PortalStep[] }>('/efiling/portal/steps', { kind }),
    select: (r) => r.items,
    staleTime: Infinity,
  });
}

export interface FilingAct { act: string; section: string }

export interface MactDetails {
  itemNo?: string | null;
  policeState?: string | null;
  policeDistrict?: string | null;
  policeTaluka?: string | null;
  otherPoliceStation?: boolean | null;
  accidentDate?: string | null;
  accidentTime?: string | null;
  accidentPlace?: string | null;
  injuryType?: 'simple' | 'serious' | 'death' | 'other' | null;
  injuredName?: string | null;
  policeStation?: string | null;
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
  /** Portal fields without a column of their own (migration 0090), merged
   *  key by key on save: reliefSought, subCourt*, dispute*, *Local. */
  extra: Partial<Record<ParticularsExtraKey, string>>;
  updatedAt: string | null;
}

export type ParticularsExtraKey =
  | 'reliefSought'
  | 'subCourtDistrict' | 'subCourtEstablishment' | 'subCourtCaseType' | 'subCourtCaseNo' | 'subCourtCaseYear'
  | 'subCourtDisposalDate' | 'subCourtCcAppliedDate' | 'subCourtCcReadyDate'
  | 'disputeState' | 'disputeDistrict' | 'disputeTaluka' | 'disputeVillage'
  | 'causeOfActionLocal' | 'prayerLocal' | 'subjectLocal';

export interface FilingParty {
  id: string;
  caseId: string;
  side: 'petitioner' | 'respondent';
  position: number;
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

export type PartyInput = Omit<FilingParty, 'id' | 'caseId' | 'position'>;

export interface CaseFact {
  id: string;
  caseId: string;
  position: number;
  factDate: string | null;
  factTime: string | null;
  description: string;
}

export interface ParticularsBundle {
  particulars: FilingParticulars | null;
  parties: FilingParty[];
  facts: CaseFact[];
}

export type FilingKind = 'new_case' | 'ia' | 'caveat' | 'misc_document' | 'deficit_court_fee';
export type FilingStatus = 'draft' | 'ready' | 'efiled' | 'submitted' | 'objected' | 'refiled' | 'accepted' | 'registered' | 'rejected' | 'withdrawn';
export type TrackingStatus = 'idle' | 'searching' | 'matched' | 'ambiguous' | 'not_found' | 'error';

export interface CnrCandidate { cino: string; title: string; establishment: string | null; caseNo: string | null }

export interface EfilingFiling {
  id: string;
  caseId: string;
  caseTitle: string;
  kind: FilingKind;
  title: string;
  status: FilingStatus;
  efilingNo: string | null;
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
  tracking: { status: TrackingStatus; lastAttemptAt: string | null; lastError: string | null; candidates: CnrCandidate[] };
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

export type PaymentPurpose = 'court_fee' | 'deficit_court_fee' | 'process_fee' | 'judicial_deposit' | 'other';

export interface FilingPayment {
  id: string;
  purpose: PaymentPurpose;
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

export interface FilingDetail extends EfilingFiling {
  documents: FilingDocument[];
  payments: FilingPayment[];
  events: FilingEvent[];
}

export interface ReadinessIssue {
  section: 'initial' | 'parties' | 'facts' | 'case_details' | 'mact' | 'documents';
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ReadinessReport { ready: boolean; errors: number; warnings: number; issues: ReadinessIssue[] }

const filingKeys = {
  list: (caseId?: string) => ['efiling', 'filings', caseId ?? 'all'] as const,
  one: (id: string) => ['efiling', 'filing', id] as const,
  readiness: (id: string) => ['efiling', 'readiness', id] as const,
  particulars: (caseId: string) => ['efiling', 'particulars', caseId] as const,
};

/** Everything that can change when a filing or its particulars change. */
function useInvalidateFiling() {
  const qc = useQueryClient();
  return (filingId?: string, caseId?: string) => {
    qc.invalidateQueries({ queryKey: ['efiling', 'filings'] });
    if (filingId) {
      qc.invalidateQueries({ queryKey: filingKeys.one(filingId) });
      qc.invalidateQueries({ queryKey: filingKeys.readiness(filingId) });
    } else {
      qc.invalidateQueries({ queryKey: ['efiling', 'readiness'] });
    }
    if (caseId) qc.invalidateQueries({ queryKey: filingKeys.particulars(caseId) });
  };
}

export function useEfilingFilings(caseId?: string) {
  return useQuery({
    queryKey: filingKeys.list(caseId),
    queryFn: () => api.get<{ items: EfilingFiling[] }>('/efiling/filings', caseId ? { caseId } : undefined),
    select: (r) => r.items,
  });
}

export function useEfilingFiling(id: string | null) {
  return useQuery({
    queryKey: filingKeys.one(id ?? ''),
    queryFn: () => api.get<FilingDetail>(`/efiling/filings/${id}`),
    enabled: !!id,
  });
}

export function useEfilingReadiness(id: string | null) {
  return useQuery({
    queryKey: filingKeys.readiness(id ?? ''),
    queryFn: () => api.get<ReadinessReport>(`/efiling/filings/${id}/readiness`),
    enabled: !!id,
  });
}

export function useCreateEfiling() {
  const invalidate = useInvalidateFiling();
  return useMutation({
    mutationFn: (input: { caseId: string; kind: FilingKind; title?: string }) => api.post<EfilingFiling>('/efiling/filings', input),
    onSuccess: (f) => invalidate(f.id, f.caseId),
  });
}

export interface FilingPatch {
  title?: string;
  efilingNo?: string | null;
  courtFilingNo?: string | null;
  courtFilingYear?: number | null;
  registrationNo?: string | null;
  objections?: string | null;
  steps?: Partial<Record<PortalStepKey, PortalStepState>>;
}

export function useUpdateEfiling(id: string) {
  const invalidate = useInvalidateFiling();
  return useMutation({
    mutationFn: (patch: FilingPatch) => api.patch<EfilingFiling>(`/efiling/filings/${id}`, patch),
    onSuccess: () => invalidate(id),
  });
}

export function useDeleteEfiling() {
  const invalidate = useInvalidateFiling();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/efiling/filings/${id}`),
    onSuccess: (_r, id) => {
      // Drop the deleted filing's cache rather than re-fetching it (a 404).
      qc.removeQueries({ queryKey: filingKeys.one(id) });
      qc.removeQueries({ queryKey: filingKeys.readiness(id) });
      invalidate();
    },
  });
}

export interface TransitionInput {
  to: FilingStatus;
  note?: string | null;
  efilingNo?: string | null;
  submittedAt?: string | null;
  objections?: string | null;
  cnr?: string | null;
}

export function useTransitionEfiling(id: string) {
  const invalidate = useInvalidateFiling();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TransitionInput) => api.post<EfilingFiling>(`/efiling/filings/${id}/transition`, input),
    onSuccess: (f) => {
      invalidate(id, f.caseId);
      // Registering attaches a CNR to the matter.
      if (f.status === 'registered') qc.invalidateQueries({ queryKey: ['cases'] });
    },
  });
}

export function useChooseEfilingCnr(id: string) {
  const invalidate = useInvalidateFiling();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cnr: string) => api.post<EfilingFiling>(`/efiling/filings/${id}/choose-cnr`, { cnr }),
    onSuccess: () => {
      invalidate(id);
      qc.invalidateQueries({ queryKey: ['cases'] });
    },
  });
}

export function useAvailableFilingDocuments(id: string | null) {
  return useQuery({
    queryKey: ['efiling', 'available-documents', id],
    queryFn: () => api.get<{ items: Array<{ id: string; name: string; sizeBytes: number | null }> }>(`/efiling/filings/${id}/available-documents`),
    select: (r) => r.items,
    enabled: !!id,
  });
}

export function useSetFilingDocuments(id: string) {
  const invalidate = useInvalidateFiling();
  return useMutation({
    mutationFn: (documents: Array<{ label: string; sourceKind: 'draft_render' | 'document'; sourceId: string }>) =>
      api.put<{ items: FilingDocument[] }>(`/efiling/filings/${id}/documents`, { documents }),
    onSuccess: () => invalidate(id),
  });
}

export interface BundleResult { pages: number; sizeBytes: number; oversize: boolean; index: Array<{ label: string; fromPage: number; toPage: number }> }

export function useBuildFilingBundle(id: string) {
  const invalidate = useInvalidateFiling();
  return useMutation({
    mutationFn: () => api.post<BundleResult>(`/efiling/filings/${id}/bundle`),
    onSuccess: () => invalidate(id),
  });
}

export function useDownloadFilingBundle(id: string) {
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.get<Blob>(`/api/efiling/filings/${id}/bundle`, { responseType: 'blob' });
      const cd = String(res.headers['content-disposition'] ?? '');
      const name = /filename="?([^";]+)"?/i.exec(cd)?.[1] ?? 'filing-bundle.pdf';
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return name;
    },
  });
}

export function useAddFilingPayment(id: string) {
  const invalidate = useInvalidateFiling();
  return useMutation({
    mutationFn: (p: { purpose: PaymentPurpose; amountInr: number; grn?: string | null; paidOn?: string | null; payerName?: string | null; mode?: FilingPayment['mode'] }) =>
      api.post<{ items: FilingPayment[] }>(`/efiling/filings/${id}/payments`, p),
    onSuccess: () => invalidate(id),
  });
}

export function useDeleteFilingPayment(id: string) {
  const invalidate = useInvalidateFiling();
  return useMutation({
    mutationFn: (paymentId: string) => api.delete<{ ok: true }>(`/efiling/filings/${id}/payments/${paymentId}`),
    onSuccess: () => invalidate(id),
  });
}

export function useRunEfilingTracking() {
  return useMutation({ mutationFn: () => api.post<{ queued: true }>('/efiling/tracking/run') });
}

// ---- Particulars ------------------------------------------------------------

export function useFilingParticulars(caseId: string | null) {
  return useQuery({
    queryKey: filingKeys.particulars(caseId ?? ''),
    queryFn: () => api.get<ParticularsBundle>(`/efiling/cases/${caseId}/particulars`),
    enabled: !!caseId,
  });
}

export type ParticularsPatch = Partial<Omit<FilingParticulars, 'caseId' | 'updatedAt'>>;

export function useUpdateFilingParticulars(caseId: string) {
  const invalidate = useInvalidateFiling();
  return useMutation({
    mutationFn: (patch: ParticularsPatch) => api.patch<FilingParticulars>(`/efiling/cases/${caseId}/particulars`, patch),
    onSuccess: () => invalidate(undefined, caseId),
  });
}

export function useAddFilingParty(caseId: string) {
  const invalidate = useInvalidateFiling();
  return useMutation({
    mutationFn: (input: PartyInput) => api.post<FilingParty>(`/efiling/cases/${caseId}/parties`, input),
    onSuccess: () => invalidate(undefined, caseId),
  });
}

export function useUpdateFilingParty(caseId: string) {
  const invalidate = useInvalidateFiling();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<PartyInput> }) =>
      api.patch<FilingParty>(`/efiling/cases/${caseId}/parties/${id}`, patch),
    onSuccess: () => invalidate(undefined, caseId),
  });
}

export function useDeleteFilingParty(caseId: string) {
  const invalidate = useInvalidateFiling();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/efiling/cases/${caseId}/parties/${id}`),
    onSuccess: () => invalidate(undefined, caseId),
  });
}

export function useSaveCaseFacts(caseId: string) {
  const invalidate = useInvalidateFiling();
  return useMutation({
    mutationFn: (facts: Array<{ factDate: string | null; factTime: string | null; description: string }>) =>
      api.put<{ items: CaseFact[] }>(`/efiling/cases/${caseId}/facts`, { facts }),
    onSuccess: () => invalidate(undefined, caseId),
  });
}

// ---- Advocate profile -------------------------------------------------------

export interface PracticeLocation {
  id?: string;
  courtTier: 'DC' | 'HC';
  stateCode: number;
  districtCode: number | null;
  bench: string | null;
  label: string | null;
}

export interface EfilingProfile {
  barEnrolmentNo: string | null;
  barCouncilStateCode: number | null;
  efilingUniqueCode: string | null;
  practiceLocations: PracticeLocation[];
}

export function useEfilingProfile() {
  return useQuery({ queryKey: ['efiling', 'profile'], queryFn: () => api.get<EfilingProfile>('/efiling/profile') });
}

export function useSaveEfilingProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<EfilingProfile>) => api.put<EfilingProfile>('/efiling/profile', input),
    onSuccess: (p) => qc.setQueryData(['efiling', 'profile'], p),
  });
}
