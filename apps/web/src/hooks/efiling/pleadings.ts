import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiClient } from '@/lib/api';

// =============================================================================
// Pleadings and Video Recording on the real eFiling portal, live over the
// advocate's own session. Backend: apps/api/src/routes/efiling-portal-
// pleadings.routes.ts (shapes mirror efiling-portal-pleadings.service.ts).
// =============================================================================

export interface PortalCall { label: string; fn: string; args: string[] }
export interface PortalOption { value: string; text: string; selected?: boolean }
export interface PleadingRow {
  cells: string[];
  actions?: string[];
  calls?: PortalCall[];
  selects?: Array<{ id: string; name: string; options: PortalOption[] }>;
  checks?: Array<{ id: string; name: string; value: string; label: string; checked: boolean }>;
}
export interface PleadingTable { headers: string[]; rows: Array<{ group: string } | PleadingRow> }
export interface CaseRef { source: string; value: string }
export interface PortalSaid { ok: boolean; portal: string[] }

export interface PleadingScreen {
  title: string;
  sources: Array<{ value: string; label: string; checked: boolean }>;
  efiled: PortalOption[];
  existing: PortalOption[];
  tabs: Array<{ id: string; label: string }>;
  labels: Record<string, string>;
  docTypes: PortalOption[] | null;
  selected: CaseRef | null;
}
export interface AddedFile { title: string; file: string; size: string; signed: boolean }
export interface PleadingCaseView {
  case: CaseRef;
  table: PleadingTable;
  parties: Array<{ side: 'pet' | 'res'; value: string; label: string; checked: boolean }>;
  clientsLabel: string;
  added: AddedFile[];
}
export interface TabList { table: PleadingTable; showAllLabel: string }
export interface AuthPerson {
  id: string; value: string; idx: string; label: string; checked: boolean;
  choices: Array<{ value: string; label: string; checked: boolean }>;
}
export interface AuthChoice {
  labels: { title: string; advocates: string; clients: string; submit: string };
  advocates: AuthPerson[];
  clients: AuthPerson[];
}
export interface GatewayView {
  url: string; done: boolean; text: string[];
  fields: Array<{ key: string; label: string; type: string; options?: PortalOption[] }>;
  buttons: string[]; screenshotBase64: string | null; portal: string[];
}
export interface OathScreen {
  title: string;
  sources: Array<{ value: string; label: string; checked: boolean }>;
  cases: PortalOption[];
  labels: Record<string, string>;
}
export interface OathDetails {
  establishment: string; causeTitle: string; caseNumber: string; litigants: string; oathMessage: string;
  clients: PortalOption[]; labels: Record<string, string>;
}

const httpStatus = (err: unknown) => (err as { response?: { status?: number } })?.response?.status;
const busyRetry = (n: number, err: unknown) => n < 4 && httpStatus(err) === 409;
const base = (sessionId: string | null) => `/efiling/live/session/${sessionId}`;

/** A portal session gone (404 expired, 410 signed out by the portal): re-check it, so the screen goes back to the login. */
function useSessionGone(sessionId: string | null) {
  const qc = useQueryClient();
  return (err: unknown) => {
    const s = httpStatus(err);
    if (s === 404 || s === 410) void qc.invalidateQueries({ queryKey: ['efiling', 'live', sessionId], exact: true });
  };
}

function useLiveMutation<V, R>(sessionId: string | null, fn: (v: V) => Promise<R>) {
  const gone = useSessionGone(sessionId);
  return useMutation({ mutationFn: fn, onError: gone });
}

/** A blob the API sent (PDF / video): a local URL, or the server's message when it failed. */
async function blobPost(path: string, body: unknown, name: string) {
  try {
    const r = await apiClient.post<Blob>(`/api${path}`, body, { responseType: 'blob' });
    return { url: URL.createObjectURL(r.data), name, type: r.data.type };
  } catch (err) {
    const data = (err as { response?: { data?: unknown } })?.response?.data;
    if (data instanceof Blob) {
      const msg = await data.text().then((t) => { try { return (JSON.parse(t) as { error?: string }).error; } catch { return undefined; } });
      if (msg) throw Object.assign(new Error(msg), { response: (err as { response?: unknown }).response });
    }
    throw err;
  }
}

// ---- Pleading Upload --------------------------------------------------------------

export function usePleadingScreen(sessionId: string | null) {
  const gone = useSessionGone(sessionId);
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'pleadings', 'screen'],
    queryFn: () => api.get<PleadingScreen>(`${base(sessionId)}/pleadings`).catch((e) => { gone(e); throw e; }),
    enabled: !!sessionId,
    staleTime: 5 * 60 * 1000,
    retry: busyRetry,
    retryDelay: 1500,
  });
}

export function usePleadingCase(sessionId: string | null, c: CaseRef | null) {
  const gone = useSessionGone(sessionId);
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'pleadings', 'case', c?.source, c?.value],
    queryFn: () => api.post<PleadingCaseView>(`${base(sessionId)}/pleadings/case`, c).catch((e) => { gone(e); throw e; }),
    enabled: !!sessionId && !!c?.value,
    staleTime: 60 * 1000,
    retry: busyRetry,
    retryDelay: 1500,
  });
}

export function useAddPleadingFile(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: CaseRef & { title: string; docType?: string | null; file: { name: string; base64: string } }) =>
    api.post<PortalSaid & { added: AddedFile[]; pleadingNumber: string | null; signed: boolean }>(`${base(sessionId)}/pleadings/add-file`, v));
}

export function useSubmitPleadingFiles(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: CaseRef & { parties: string[] }) =>
    api.post<PortalSaid & { view: PleadingCaseView }>(`${base(sessionId)}/pleadings/submit`, { ...v, confirmed: true }));
}

export function useDeletePleading(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: CaseRef & { pleadingNumber: string }) =>
    api.post<PortalSaid & { view: PleadingCaseView }>(`${base(sessionId)}/pleadings/delete`, { ...v, confirmed: true }));
}

export function useMergePleadings(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: CaseRef & { pleadingNumbers: string[]; title: string }) =>
    api.post<PortalSaid & { view: PleadingCaseView }>(`${base(sessionId)}/pleadings/merge`, { ...v, confirmed: true }));
}

/** A pleading's PDF as the portal shows it; resolves to a local URL. */
export function useViewPleadingFile(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: CaseRef & { pleadingNumber: string }) => blobPost(`${base(sessionId)}/pleadings/file`, v, `${v.pleadingNumber}.pdf`));
}

// ---- Pleading Index ---------------------------------------------------------------

export function usePleadingIndex(sessionId: string | null, c: CaseRef | null, all: boolean, enabled: boolean) {
  const gone = useSessionGone(sessionId);
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'pleadings', 'index', c?.source, c?.value, all],
    queryFn: () => api.post<TabList>(`${base(sessionId)}/pleadings/index`, { ...c, all }).catch((e) => { gone(e); throw e; }),
    enabled: !!sessionId && !!c?.value && enabled,
    staleTime: 60 * 1000,
    retry: busyRetry,
    retryDelay: 1500,
  });
}

export function useAddPleadingIndex(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: CaseRef & { pleadingNumber: string; title: string; fromPage: number; toPage: number }) =>
    api.post<PortalSaid & TabList>(`${base(sessionId)}/pleadings/index/add`, v));
}

export function useDeletePleadingIndex(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: CaseRef & { pleadingNumber: string; srNo: string }) =>
    api.post<PortalSaid & TabList>(`${base(sessionId)}/pleadings/index/delete`, { ...v, confirmed: true }));
}

// ---- eSign ----------------------------------------------------------------------

export function usePleadingEsign(sessionId: string | null, c: CaseRef | null, all: boolean, enabled: boolean) {
  const gone = useSessionGone(sessionId);
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'pleadings', 'esign', c?.source, c?.value, all],
    queryFn: () => api.post<TabList>(`${base(sessionId)}/pleadings/esign`, { ...c, all }).catch((e) => { gone(e); throw e; }),
    enabled: !!sessionId && !!c?.value && enabled,
    staleTime: 60 * 1000,
    retry: busyRetry,
    retryDelay: 1500,
  });
}

export function usePleadingAuth(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: CaseRef & { pleadingNumber: string; pdeNo: string; dirMonth?: string }) =>
    api.post<AuthChoice>(`${base(sessionId)}/pleadings/esign/auth`, v));
}

export function useSavePleadingAuth(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: CaseRef & { pleadingNumber: string; advocates: Array<{ value: string; sign: string }>; clients: Array<{ value: string; sign: string }> }) =>
    api.post<PortalSaid & TabList>(`${base(sessionId)}/pleadings/esign/auth/save`, v));
}

export function useStartPleadingEsign(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: CaseRef & { pleadingNumber: string; signCounter: string; pageCreated: string; userName: string }) =>
    api.post<GatewayView>(`${base(sessionId)}/pleadings/esign/start`, { ...v, accepted: true }));
}

export function useStepPleadingEsign(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: { values: Record<string, string>; press: string }) =>
    api.post<GatewayView>(`${base(sessionId)}/pleadings/esign/step`, v));
}

export function useSendPleadingOtp(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: CaseRef & { args: string[]; mobile: string }) =>
    api.post<PortalSaid & { button: string; locked: boolean }>(`${base(sessionId)}/pleadings/esign/otp/send`, v));
}

export function useVerifyPleadingOtp(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: { otp: string }) =>
    api.post<PortalSaid & Partial<TabList>>(`${base(sessionId)}/pleadings/esign/otp/verify`, v));
}

// ---- Dashboard: Draft Pleadings / Completed Pleadings --------------------------------

export function useDraftPleadings(sessionId: string | null, kind: 'draft' | 'completed') {
  const gone = useSessionGone(sessionId);
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'pleadings', 'drafts', kind],
    queryFn: () => api.get<PleadingTable & { total: number }>(`${base(sessionId)}/pleadings/drafts/${kind}`).catch((e) => { gone(e); throw e; }),
    enabled: !!sessionId,
    staleTime: 60 * 1000,
    retry: busyRetry,
    retryDelay: 1500,
  });
}

export function useSubmitDraftPleading(sessionId: string | null) {
  const qc = useQueryClient();
  const gone = useSessionGone(sessionId);
  return useMutation({
    mutationFn: (v: { uniqueId: string; typeOfCase: string; efilingNumber: string; grn: string; withoutCourtFee?: boolean }) =>
      api.post<PortalSaid & { list: PleadingTable & { total: number } }>(`${base(sessionId)}/pleadings/drafts/submit`, { ...v, confirmed: true }),
    onSuccess: (r) => qc.setQueryData(['efiling', 'live', sessionId, 'pleadings', 'drafts', 'draft'], r.list),
    onError: gone,
  });
}

export function useResubmitPleading(sessionId: string | null) {
  const qc = useQueryClient();
  const gone = useSessionGone(sessionId);
  return useMutation({
    mutationFn: (v: { efilingNumber: string }) =>
      api.post<PortalSaid & { list: PleadingTable & { total: number } }>(`${base(sessionId)}/pleadings/drafts/resubmit`, { ...v, confirmed: true }),
    onSuccess: (r) => qc.setQueryData(['efiling', 'live', sessionId, 'pleadings', 'drafts', 'completed'], r.list),
    onError: gone,
  });
}

// ---- Video Recording (oath) ---------------------------------------------------------

export function useOathScreen(sessionId: string | null) {
  const gone = useSessionGone(sessionId);
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'oath', 'screen'],
    queryFn: () => api.get<OathScreen>(`${base(sessionId)}/oath`).catch((e) => { gone(e); throw e; }),
    enabled: !!sessionId,
    staleTime: 5 * 60 * 1000,
    retry: busyRetry,
    retryDelay: 1500,
  });
}

export function useOathCase(sessionId: string | null, v: { searchCase: string; pdeNo: string } | null) {
  const gone = useSessionGone(sessionId);
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'oath', 'case', v?.searchCase, v?.pdeNo],
    queryFn: () => api.post<{ documents: PortalOption[]; videos: PleadingTable }>(`${base(sessionId)}/oath/case`, v).catch((e) => { gone(e); throw e; }),
    enabled: !!sessionId && !!v?.pdeNo,
    staleTime: 60 * 1000,
    retry: busyRetry,
    retryDelay: 1500,
  });
}

export function useOathDocument(sessionId: string | null, v: { searchCase: string; pdeNo: string; document: string } | null) {
  const gone = useSessionGone(sessionId);
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'oath', 'document', v?.searchCase, v?.pdeNo, v?.document],
    queryFn: () => api.post<OathDetails>(`${base(sessionId)}/oath/document`, v).catch((e) => { gone(e); throw e; }),
    enabled: !!sessionId && !!v?.document,
    staleTime: 60 * 1000,
    retry: busyRetry,
    retryDelay: 1500,
  });
}

export function useUploadOath(sessionId: string | null) {
  const qc = useQueryClient();
  const gone = useSessionGone(sessionId);
  return useMutation({
    mutationFn: (v: { searchCase: string; pdeNo: string; document: string; client: string; video: { base64: string; mimeType: string } }) =>
      api.post<PortalSaid & { videos: PleadingTable }>(`${base(sessionId)}/oath/upload`, { ...v, confirmed: true }),
    onSuccess: (r, v) => qc.setQueryData(['efiling', 'live', sessionId, 'oath', 'case', v.searchCase, v.pdeNo],
      (old: { documents: PortalOption[]; videos: PleadingTable } | undefined) => (old ? { ...old, videos: r.videos } : old)),
    onError: gone,
  });
}

/** An oath video as the portal plays it; resolves to a local URL. */
export function usePlayOath(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: { filepath: string }) => blobPost(`${base(sessionId)}/oath/play`, v, 'oath'));
}

/** A File -> base64 (no data: prefix), for the JSON upload. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}

// ---- Existing case search / Use Template --------------------------------------------

/** Existing case: the advocate's cases matching what they typed (3+ letters). */
export function useSearchPleadingCases(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: { term: string }) => api.post<{ items: PortalOption[] }>(`${base(sessionId)}/pleadings/cases/search`, v));
}

export interface TemplateScreen {
  title: string;
  sources: Array<{ value: string; label: string; checked: boolean }>;
  efiled: PortalOption[];
  labels: Record<string, string>;
}
export interface TemplateCaseView {
  case: CaseRef;
  pleadingTypes: PortalOption[];
  parties: Array<{ side: 'pet' | 'res'; value: string; label: string; checked: boolean }>;
  clientsLabel: string;
}

export function useTemplateScreen(sessionId: string | null) {
  const gone = useSessionGone(sessionId);
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'templates', 'screen'],
    queryFn: () => api.get<TemplateScreen>(`${base(sessionId)}/templates`).catch((e) => { gone(e); throw e; }),
    enabled: !!sessionId,
    staleTime: 5 * 60 * 1000,
    retry: busyRetry,
    retryDelay: 1500,
  });
}

export function useTemplateCase(sessionId: string | null, c: CaseRef | null) {
  const gone = useSessionGone(sessionId);
  return useQuery({
    queryKey: ['efiling', 'live', sessionId, 'templates', 'case', c?.source, c?.value],
    queryFn: () => api.post<TemplateCaseView>(`${base(sessionId)}/templates/case`, c).catch((e) => { gone(e); throw e; }),
    enabled: !!sessionId && !!c?.value,
    staleTime: 60 * 1000,
    retry: busyRetry,
    retryDelay: 1500,
  });
}

/** Generate: the filled template the portal makes (.doc); resolves to a local URL. */
export function useGenerateTemplate(sessionId: string | null) {
  return useLiveMutation(sessionId, (v: CaseRef & { typePleading: string; parties: string[] }) =>
    blobPost(`${base(sessionId)}/templates/generate`, v, 'template.doc'));
}
