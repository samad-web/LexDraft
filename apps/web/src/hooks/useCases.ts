import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Case, CaseAct, CaseParty, CasePipeline, MatterTimelineEvent } from '@lexdraft/types';
import { api } from '@/lib/api';

export type CaseWithPipeline = Case & { pipeline?: CasePipeline };

export function useCases(filter?: { type?: string; q?: string }) {
  return useQuery({
    queryKey: ['cases', filter],
    queryFn: () => api.get<{ items: Case[] }>('/cases', filter),
    select: (r) => r.items,
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
