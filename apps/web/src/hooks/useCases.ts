import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Case, CaseAct, CaseParty, CasePipeline, MatterTimelineEvent } from '@lexdraft/types';
import { api } from '@/lib/api';

/** eCourts connection state, present on GET /cases/:id (migration 0085). */
export interface CaseEcourtsLink {
  ecourtsLinkStatus?: 'unlinked' | 'pending' | 'linked' | 'not_found' | 'error';
  ecourtsCourtTier?: 'DC' | 'HC' | null;
  ecourtsLastAttemptAt?: string | null;
  ecourtsLastError?: string | null;
}

export type CaseWithPipeline = Case & CaseEcourtsLink & { pipeline?: CasePipeline };

/** List rows also carry the matter's eCourts link status. */
export type CaseListItem = Case & Pick<CaseEcourtsLink, 'ecourtsLinkStatus'>;

/** `ecourts: 'attention'` = live matters not yet working with eCourts (no
 *  CNR, waiting, CNR not found, error) - the "Connect matters" view. */
export function useCases(filter?: { type?: string; q?: string; ecourts?: 'attention' }, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['cases', filter],
    queryFn: () => api.get<{ items: CaseListItem[] }>('/cases', filter),
    select: (r) => r.items,
    enabled: opts?.enabled ?? true,
  });
}

export function useCase(id: string | null | undefined) {
  return useQuery({
    queryKey: ['cases', id],
    queryFn: () => api.get<CaseWithPipeline>(`/cases/${id}`),
    enabled: !!id,
  });
}

/** Acts & sections the matter is filed under. Populated by the eCourts sync;
 *  empty until the user clicks "Sync from eCourts". */
export function useCaseActs(id: string | null | undefined) {
  return useQuery({
    queryKey: ['cases', id, 'acts'],
    queryFn: () => api.get<{ items: CaseAct[] }>(`/cases/${id}/acts`),
    select: (r) => r.items,
    enabled: !!id,
  });
}

/** Parties (petitioner / respondent + extras + advocates). Populated by the
 *  eCourts sync. */
export function useCaseParties(id: string | null | undefined) {
  return useQuery({
    queryKey: ['cases', id, 'parties'],
    queryFn: () => api.get<{ items: CaseParty[] }>(`/cases/${id}/parties`),
    select: (r) => r.items,
    enabled: !!id,
  });
}

export function useCaseTimeline(id: string | null | undefined) {
  return useQuery({
    queryKey: ['cases', id, 'timeline'],
    queryFn: () => api.get<{ items: MatterTimelineEvent[] }>(`/cases/${id}/timeline`),
    select: (r) => r.items,
    enabled: !!id,
  });
}

interface TransitionInput {
  id: string;
  toStage: string;
  note?: string;
  visibleToPortal?: boolean;
}

export function useTransitionCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, toStage, note, visibleToPortal }: TransitionInput) =>
      api.post<CaseWithPipeline & { transition: { fromStage: string | null; toStage: string } }>(
        `/cases/${id}/transition`,
        { toStage, note, visibleToPortal },
      ),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['cases'] });
      qc.invalidateQueries({ queryKey: ['cases', variables.id, 'timeline'] });
    },
  });
}

export function useCreateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Case, 'id'>) => api.post<Case>('/cases', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cases'] }),
  });
}

export function useUpdateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Case> }) =>
      api.patch<Case>(`/cases/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cases'] }),
  });
}

/** Soft-delete a matter (recoverable for 30 days). */
export function useDeleteCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/cases/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cases'] });
      qc.invalidateQueries({ queryKey: ['cases', 'trash'] });
    },
  });
}

/** Restore a soft-deleted matter within the 30-day window. */
export function useRestoreCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/cases/${id}/restore`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cases'] });
      qc.invalidateQueries({ queryKey: ['cases', 'trash'] });
    },
  });
}

/** A soft-deleted matter, with the deletion timestamp for the 30-day countdown. */
export type DeletedCase = Case & { deletedAt: string };

/** List the firm's recently-deleted matters (within the 30-day window). */
export function useDeletedCases() {
  return useQuery({
    queryKey: ['cases', 'trash'],
    queryFn: () => api.get<{ items: DeletedCase[] }>('/cases/trash/list'),
    select: (r) => r.items,
  });
}

export interface EcourtsSyncSurface {
  finalOrders: number;
  interimOrders: number;
  transfers: Array<{ on: string; from: string; to: string }>;
}

export interface EcourtsSyncResult extends CaseWithPipeline {
  sync: {
    changes: Record<string, { from: unknown; to: unknown }>;
    hearingsReplaced: number;
    actsReplaced: number;
    partiesReplaced: number;
    sideDetected: 'petitioner' | 'respondent' | null;
    surfaceOnly: EcourtsSyncSurface;
  };
}

/**
 * Pull live data from the eCourts gateway and fold it into the matter row +
 * its hearings. Server-side mapping is documented in case-sync.service.ts.
 *
 * Callers may pass `side` explicitly when auto-detection (firm-client name vs
 * petitioner/respondent) is going to be wrong; otherwise it's left undefined
 * and the server attempts the match.
 */
export function useSyncCaseFromEcourts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      side?: 'petitioner' | 'respondent';
      overwriteAll?: boolean;
      court?: 'DC' | 'HC';
    }) =>
      api.post<EcourtsSyncResult>(`/cases/${id}/sync-from-ecourts`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['cases'] });
      qc.invalidateQueries({ queryKey: ['cases', variables.id, 'timeline'] });
      qc.invalidateQueries({ queryKey: ['cases', variables.id, 'acts'] });
      qc.invalidateQueries({ queryKey: ['cases', variables.id, 'parties'] });
      // Hearings come back from a separate query — refetch them too.
      qc.invalidateQueries({ queryKey: ['hearings'] });
      qc.invalidateQueries({ queryKey: ['calendar'] });
      // The sync's live lookup also refreshed the stored eCourts copy that
      // the case page's eCourts snapshot and tab read.
      qc.invalidateQueries({ queryKey: ['ecourts', 'cnr'] });
    },
  });
}

export interface EcourtsCnrCandidate {
  cino: string;
  title: string;
  establishment: string | null;
  caseNo: string | null;
}

export type LinkCaseInput =
  | { id: string; cnr: string; court?: 'DC' | 'HC' }
  | {
      id: string;
      court?: 'DC' | 'HC';
      stateCode: number;
      distCode: number;
      courtCode: number;
      estCode: string;
      caseType: string | number;
      regNo: string | number;
      year: number;
    };

export type LinkCaseResult =
  | { status: 'linked'; cnr: string; case: CaseWithPipeline }
  | { status: 'pending'; cnr: string; message: string; case: CaseWithPipeline }
  | { status: 'choose'; candidates: EcourtsCnrCandidate[] };

/**
 * Connect a matter to eCourts after the fact - by CNR, or by case type +
 * number + year (the server resolves the CNR). 'pending' means the CNR was
 * saved but eCourts is down; the server keeps retrying in the background.
 */
export interface EcourtsImportItem { cnr: string; court?: 'DC' | 'HC' }
export interface EcourtsImportResult {
  created: Array<{ cnr: string; id: string }>;
  existing: string[];
  invalid: string[];
}

/** Which CNRs are already in matters - the import preview. */
export function useEcourtsImportPreview() {
  return useMutation({
    mutationFn: (items: EcourtsImportItem[]) =>
      api.post<{ existing: string[] }>('/cases/import/ecourts', { items, dryRun: true }),
  });
}

/** My Cases import: new CNRs become matters that eCourts fills in. */
export function useImportEcourtsCases() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: EcourtsImportItem[]) => api.post<EcourtsImportResult>('/cases/import/ecourts', { items }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cases'] });
      qc.invalidateQueries({ queryKey: ['ecourts', 'sync-status'] });
    },
  });
}

export function useLinkCaseToEcourts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: LinkCaseInput) =>
      api.post<LinkCaseResult>(`/cases/${id}/ecourts/link`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['cases'] });
      qc.invalidateQueries({ queryKey: ['cases', variables.id, 'acts'] });
      qc.invalidateQueries({ queryKey: ['cases', variables.id, 'parties'] });
      qc.invalidateQueries({ queryKey: ['hearings'] });
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['ecourts', 'sync-status'] });
    },
  });
}

// ---- Firm-level custom pipeline stages -------------------------------------
// The pipeline catalog ships canonical stages (Filing → Summons → … → Appeal)
// per matter type. Firms append their own here — IA, Mediation, Pre-filing
// review, anything practice-specific. The list is merged into every snapshot
// returned by GET /cases/:id, so the matter-detail stepper renders custom
// stages alongside the defaults without any second round trip.

export interface FirmCustomStage {
  id: string;
  kind: 'civil' | 'criminal' | 'consumer' | 'writ' | 'default' | 'all';
  stageName: string;
  position: number;
  createdAt: string;
}

export function useFirmCaseStages() {
  return useQuery({
    queryKey: ['firm', 'case-stages'],
    queryFn: () => api.get<{ items: FirmCustomStage[] }>('/firm/case-stages'),
    select: (r) => r.items,
  });
}

export function useAddFirmCaseStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: FirmCustomStage['kind']; stageName: string; position?: number }) =>
      api.post<FirmCustomStage>('/firm/case-stages', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['firm', 'case-stages'] });
      // The merged catalog lives inside each case's pipeline snapshot, so
      // bust the cached case payloads too.
      qc.invalidateQueries({ queryKey: ['cases'] });
    },
  });
}

export function useDeleteFirmCaseStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/firm/case-stages/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['firm', 'case-stages'] });
      qc.invalidateQueries({ queryKey: ['cases'] });
    },
  });
}
