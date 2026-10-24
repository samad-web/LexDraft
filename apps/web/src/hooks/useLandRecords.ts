import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiClient } from '@/lib/api';

// Tamil Nadu Land Records eServices (eservices.tn.gov.in) - see
// apps/api/src/routes/land-records.routes.ts. Every search is a live session
// on the site: pick from its own lists, then the OTP it texts to the mobile
// number entered (or the captcha it shows), then the result.

export type LandService =
  | 'patta' | 'a-register' | 'verify-patta' | 'poramboke' | 'fmb'
  | 'order-copy' | 'tslr-extract' | 'tslr-sketch' | 'app-status' | 'fline';

export type LandListField = 'district' | 'taluk' | 'village' | 'ward' | 'block' | 'survey' | 'subdiv';
export type LandFormShape = 'rural' | 'rural-plain' | 'urban' | 'appid' | 'refno';

export interface LandOption { value: string; label: string }

export interface LandFormFields {
  viewBy?: 'pt' | 'sur';
  pattaNo?: string;
  landType?: 'R' | 'N';
  surveyNo?: string;
  subdivNo?: string;
  applicationId?: string;
  refNo?: string;
}

export interface LandSessionStart {
  sessionId: string;
  service: LandService;
  title: string;
  gate: 'otp' | 'captcha';
  form: LandFormShape;
  districts: LandOption[];
  captchaImage?: string;
}

export interface LandSelectResult {
  next: LandListField | null;
  options: LandOption[];
  askLandType?: boolean;
  message?: string;
}

export interface LandResult {
  title: string;
  fields: Array<{ label: string; value: string }>;
  sections: Array<{ heading: string | null; headers: string[]; rows: string[][] }>;
  text: string;
  hasPdf: boolean;
}

export type LandSubmit =
  | { status: 'ok'; result: LandResult; recorded?: boolean }
  | { status: 'retry'; reason: string; captchaImage: string };

export interface LandApplication {
  id: string;
  caseId: string | null;
  caseTitle: string | null;
  titleReportId: string | null;
  applicationId: string;
  kind: 'patta_transfer' | 'fline' | 'other';
  note: string | null;
  lastStatus: string | null;
  lastCheckedAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

const BASE = '/land-records';

/** Fire-and-forget: the server pre-loads the site so the first service opens fast. */
export function prepareLandRecords(): void {
  void api.post(`${BASE}/prepare`).catch(() => {});
}

export function useStartLandSession() {
  return useMutation({
    mutationFn: (service: LandService) => api.post<LandSessionStart>(`${BASE}/sessions`, { service }),
  });
}

export function useSelectLandField() {
  return useMutation({
    mutationFn: ({ sessionId, field, value }: { sessionId: string; field: LandListField; value: string }) =>
      api.post<LandSelectResult>(`${BASE}/sessions/${sessionId}/select`, { field, value }),
  });
}

export function useLandSubdivisions() {
  return useMutation({
    mutationFn: ({ sessionId, surveyNo, landType }: { sessionId: string; surveyNo: string; landType?: 'R' | 'N' }) =>
      api.post<LandSelectResult>(`${BASE}/sessions/${sessionId}/subdivisions`, { surveyNo, ...(landType ? { landType } : {}) }),
  });
}

export function useSendLandOtp() {
  return useMutation({
    mutationFn: ({ sessionId, mobile, fields }: { sessionId: string; mobile: string; fields: LandFormFields }) =>
      api.post<{ message: string }>(`${BASE}/sessions/${sessionId}/otp`, { mobile, fields }),
  });
}

export function useVerifyLandOtp() {
  return useMutation({
    mutationFn: ({ sessionId, otp }: { sessionId: string; otp: string }) =>
      api.post<LandSubmit>(`${BASE}/sessions/${sessionId}/otp/verify`, { otp }),
  });
}

export function useSubmitLandCaptcha() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, captcha, fields }: { sessionId: string; captcha: string; fields: LandFormFields }) =>
      api.post<LandSubmit>(`${BASE}/sessions/${sessionId}/captcha`, { captcha, fields }),
    onSuccess: (r) => {
      if (r.status === 'ok' && r.recorded) void qc.invalidateQueries({ queryKey: ['land-records', 'applications'] });
    },
  });
}

export function useRefreshLandCaptcha() {
  return useMutation({
    mutationFn: (sessionId: string) => api.post<{ captchaImage: string }>(`${BASE}/sessions/${sessionId}/captcha/refresh`),
  });
}

export function useEndLandSession() {
  return useMutation({
    mutationFn: (sessionId: string) => api.delete<void>(`${BASE}/sessions/${sessionId}`),
  });
}

/** The result's PDF (page print, or the sketch) as a Blob. */
export async function fetchLandPdf(sessionId: string): Promise<{ blob: Blob; filename: string }> {
  const r = await apiClient.get(`/api${BASE}/sessions/${sessionId}/pdf`, { responseType: 'blob' });
  const cd = String(r.headers['content-disposition'] ?? '');
  const filename = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'land-record.pdf';
  return { blob: r.data as Blob, filename };
}

export function useSaveLandResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, caseId, titleReportId }: { sessionId: string; caseId?: string; titleReportId?: string }) =>
      api.post<{ documentId: string | null; titleReportSearchId: string | null; name: string }>(
        `${BASE}/sessions/${sessionId}/save`,
        { ...(caseId ? { caseId } : {}), ...(titleReportId ? { titleReportId } : {}) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['title-reports'] });
    },
  });
}

// ---- Followed applications ---------------------------------------------------

export function useLandApplications(caseId?: string) {
  return useQuery({
    queryKey: ['land-records', 'applications', caseId ?? 'all'],
    queryFn: () => api.get<{ items: LandApplication[] }>(`${BASE}/applications`, caseId ? { caseId } : undefined),
    select: (r) => r.items,
    retry: false,
  });
}

export function useAddLandApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { applicationId: string; kind: LandApplication['kind']; caseId?: string | null; titleReportId?: string | null; note?: string | null }) =>
      api.post<LandApplication>(`${BASE}/applications`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['land-records', 'applications'] }),
  });
}

export function useUpdateLandApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; closed?: boolean; note?: string | null; caseId?: string | null }) =>
      api.patch<void>(`${BASE}/applications/${id}`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['land-records', 'applications'] }),
  });
}

export function useRemoveLandApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`${BASE}/applications/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['land-records', 'applications'] }),
  });
}
