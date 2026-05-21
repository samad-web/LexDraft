/**
 * Title Reports hooks — React Query surface mapped 1:1 against the
 * /api/title-reports endpoints in apps/api/src/routes/title-reports.routes.ts.
 *
 * Cache keys:
 *   ['title-reports']                 -> list (filtered)
 *   ['title-reports', id]             -> hydrated tree
 *   ['title-reports', 'quota']        -> Solo monthly quota status
 *   ['title-reports', id, 'ai', runId]-> AI run status (polled)
 *
 * Mutations invalidate the affected keys so the wizard's autosave reflects
 * server-side changes without manual cache patching.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChainLinkDto,
  CreateTitleReportDto,
  DefectAckDto,
  EncumbranceDto,
  ExtractDocumentDto,
  HeirDto,
  LitigationEntryDto,
  ManualDefectDto,
  RunAiAnalysisDto,
  SearchEntryDto,
  StatutoryApprovalDto,
  TitleReport,
  TitleReportAiRun,
  TitleReportChainLink,
  TitleReportDefect,
  TitleReportDocument,
  TitleReportEncumbrance,
  TitleReportExport,
  TitleReportFull,
  TitleReportHeir,
  TitleReportLitigation,
  TitleReportListQuery,
  TitleReportListResponse,
  TitleReportProperty,
  TitleReportQuotaStatus,
  TitleReportSearch,
  TitleReportStatus,
  TitleReportStatutoryApproval,
  TitleReportTransitionDto,
  UpdateTitleReportDto,
  UpsertTitleReportPropertyDto,
} from '@lexdraft/types';
import { api } from '@/lib/api';

const ROOT = '/title-reports';
const KEY = ['title-reports'] as const;
const detailKey = (id: string) => [...KEY, id] as const;
const aiRunKey = (id: string, runId: string) => [...KEY, id, 'ai', runId] as const;
const quotaKey = [...KEY, 'quota'] as const;

function querystring(q: TitleReportListQuery): string {
  const params = new URLSearchParams();
  if (q.status) params.set('status', q.status);
  if (q.jurisdictionState) params.set('jurisdictionState', q.jurisdictionState);
  if (q.assignedTo) params.set('assignedTo', q.assignedTo);
  if (q.bank) params.set('bank', q.bank);
  if (q.q) params.set('q', q.q);
  if (q.page) params.set('page', String(q.page));
  if (q.pageSize) params.set('pageSize', String(q.pageSize));
  const s = params.toString();
  return s ? `?${s}` : '';
}

// ---- Queries --------------------------------------------------------------

export function useTitleReports(query: TitleReportListQuery = {}) {
  return useQuery({
    queryKey: [...KEY, query],
    queryFn: () => api.get<TitleReportListResponse>(`${ROOT}${querystring(query)}`),
    staleTime: 15_000,
  });
}

export function useTitleReport(id: string | null) {
  return useQuery({
    queryKey: id ? detailKey(id) : [...KEY, 'detail', null],
    queryFn: () => api.get<TitleReportFull>(`${ROOT}/${id}`),
    enabled: !!id,
  });
}

export function useTitleReportQuota() {
  return useQuery({
    queryKey: quotaKey,
    queryFn: () => api.get<TitleReportQuotaStatus>(`${ROOT}/quota`),
    staleTime: 30_000,
  });
}

/** Poll an AI run until it reaches terminal status. Interval = 1.5s,
 *  stops automatically once `status` is 'done' or 'failed'. */
export function useTitleReportAiRun(reportId: string | null, runId: string | null) {
  return useQuery({
    queryKey: reportId && runId ? aiRunKey(reportId, runId) : [...KEY, 'ai', null],
    queryFn: () => api.get<TitleReportAiRun>(`${ROOT}/${reportId}/ai/runs/${runId}`),
    enabled: !!(reportId && runId),
    refetchInterval: (q) => {
      const data = q.state.data as TitleReportAiRun | undefined;
      if (!data) return 1500;
      return data.status === 'done' || data.status === 'failed' ? false : 1500;
    },
  });
}

// ---- Header mutations -----------------------------------------------------

export function useCreateTitleReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTitleReportDto) => api.post<TitleReport>(ROOT, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useUpdateTitleReport(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTitleReportDto) => api.patch<TitleReport>(`${ROOT}/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: detailKey(id) });
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

/** Soft-deletes the report by transitioning it to 'withdrawn'. The reason
 *  surfaces in the audit row. (api.delete here doesn't accept a body, and we
 *  want the reason to land somewhere queryable; the transition endpoint is
 *  the right hammer.) */
export function useDeleteTitleReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post<TitleReport>(`${ROOT}/${id}/transition`, { to: 'withdrawn', reason }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: detailKey(vars.id) });
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useTransitionTitleReport(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TitleReportTransitionDto) => api.post<TitleReport>(`${ROOT}/${id}/transition`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: detailKey(id) });
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

// ---- Sub-table mutations --------------------------------------------------

export function useUpsertProperty(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertTitleReportPropertyDto) =>
      api.post<TitleReportProperty>(`${ROOT}/${id}/property`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function useAddChainLink(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ChainLinkDto) => api.post<TitleReportChainLink>(`${ROOT}/${id}/chain-links`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function useUpdateChainLink(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { linkId: string; patch: Partial<ChainLinkDto> }) =>
      api.patch<TitleReportChainLink>(`${ROOT}/${id}/chain-links/${vars.linkId}`, vars.patch),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function useDeleteChainLink(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => api.delete<void>(`${ROOT}/${id}/chain-links/${linkId}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export interface DocumentUploadDto {
  documentType: TitleReportDocument['documentType'];
  documentLabel: string;
  parties?: string;
  documentDate?: string;
  registrationNo?: string;
  sroOffice?: string;
  copyType?: TitleReportDocument['copyType'];
  storageRef?: string;
  fileName?: string;
  fileMime?: string;
  fileSize?: number;
}

export function useAddDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DocumentUploadDto) => api.post<TitleReportDocument>(`${ROOT}/${id}/documents`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function usePatchDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { docId: string; patch: Partial<DocumentUploadDto> & {
      extractedPayload?: Record<string, unknown>;
      extractionStatus?: TitleReportDocument['extractionStatus'];
    } }) => api.patch<TitleReportDocument>(`${ROOT}/${id}/documents/${vars.docId}`, vars.patch),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function useExtractDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { docId: string; body?: ExtractDocumentDto }) =>
      api.post<{ documentId: string; status: string; extractedPayload: Record<string, unknown>; confidence: number }>(
        `${ROOT}/${id}/documents/${vars.docId}/extract`,
        vars.body ?? {},
      ),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export interface ApplyExtractionResult {
  applied: 'chain_link' | 'encumbrance' | 'property' | 'none';
  chainLinkId?: string;
  encumbranceIds?: string[];
  propertyId?: string;
  fieldsApplied: string[];
  message: string;
}

/** Route the extracted fields on a document into the right report sub-row
 *  (new chain link for sale/gift/partition/will, encumbrance rows for EC,
 *  property.jurisdiction_specific merge for patta/khata/RTC/7-12). The
 *  service never overwrites existing user-entered values. */
export function useApplyTitleReportDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) =>
      api.post<ApplyExtractionResult>(`${ROOT}/${id}/documents/${docId}/apply`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function useAddEncumbrance(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EncumbranceDto) => api.post<TitleReportEncumbrance>(`${ROOT}/${id}/encumbrances`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function usePatchEncumbrance(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { encId: string; patch: Partial<EncumbranceDto> }) =>
      api.patch<TitleReportEncumbrance>(`${ROOT}/${id}/encumbrances/${vars.encId}`, vars.patch),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function useDeleteEncumbrance(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (encId: string) => api.delete<void>(`${ROOT}/${id}/encumbrances/${encId}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function useAddSearch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SearchEntryDto) => api.post<TitleReportSearch>(`${ROOT}/${id}/searches`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function useAddLitigation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LitigationEntryDto) => api.post<TitleReportLitigation>(`${ROOT}/${id}/litigation`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function useDeleteLitigation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (litId: string) => api.delete<void>(`${ROOT}/${id}/litigation/${litId}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function useAddApproval(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StatutoryApprovalDto) => api.post<TitleReportStatutoryApproval>(`${ROOT}/${id}/approvals`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function useDeleteApproval(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (apId: string) => api.delete<void>(`${ROOT}/${id}/approvals/${apId}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function useAddHeir(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: HeirDto) => api.post<TitleReportHeir>(`${ROOT}/${id}/heirs`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function useAddDefect(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ManualDefectDto) => api.post<TitleReportDefect>(`${ROOT}/${id}/defects`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

export function useApplyDefectAck(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { defectId: string; body: DefectAckDto }) =>
      api.patch<TitleReportDefect>(`${ROOT}/${id}/defects/${vars.defectId}`, vars.body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

// ---- AI mutations ---------------------------------------------------------

export function useRunAiAnalysis(id: string) {
  return useMutation({
    mutationFn: (body: RunAiAnalysisDto = {}) =>
      api.post<{ runId: string; status: string }>(`${ROOT}/${id}/ai/analyse`, body),
  });
}

export function useSynthesiseOpinion(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ runId: string; output: Record<string, unknown> }>(`${ROOT}/${id}/ai/opinion`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

// ---- Export ---------------------------------------------------------------

export interface RecordExportDto {
  format?: 'pdf' | 'docx';
  letterheadId?: string;
  storageRef?: string;
  fileName?: string;
  fileMime?: string;
  fileSize?: number;
}

export function useRecordTitleReportExport(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordExportDto = {}) => api.post<TitleReportExport>(`${ROOT}/${id}/export`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: detailKey(id) }); },
  });
}

// ---- Helpers --------------------------------------------------------------

export const STATUS_LABEL: Record<TitleReportStatus, string> = {
  draft:     'Draft',
  in_review: 'In review',
  finalised: 'Finalised',
  issued:    'Issued',
  withdrawn: 'Withdrawn',
};

export const JURISDICTION_LABEL: Record<string, string> = {
  TN: 'Tamil Nadu', KA: 'Karnataka', MH: 'Maharashtra', TG: 'Telangana',
  AP: 'Andhra Pradesh', DL: 'Delhi', UP: 'Uttar Pradesh', GJ: 'Gujarat',
  RJ: 'Rajasthan', WB: 'West Bengal', KL: 'Kerala', PB: 'Punjab',
  HR: 'Haryana', MP: 'Madhya Pradesh', CG: 'Chhattisgarh', OR: 'Odisha',
  JH: 'Jharkhand', BR: 'Bihar', AS: 'Assam', OTHER: 'Other / UT',
};
