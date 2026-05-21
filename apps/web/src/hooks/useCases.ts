import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Case, CasePipeline, MatterTimelineEvent } from '@lexdraft/types';
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
