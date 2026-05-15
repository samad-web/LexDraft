/**
 * Coverage swap board - TanStack Query wrappers.
 *
 * Read query (`useCoverageList`) returns all firm-scoped coverage requests
 * the caller has access to. The mutations invalidate the list after each
 * write so the board reflects current state without a manual refetch.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type CoverageStatus = 'open' | 'claimed' | 'cancelled' | 'completed';

export interface CoverageRequest {
  id: string;
  firmId: string;
  hearingId: string | null;
  caseId: string | null;
  caseLabel: string;
  court: string;
  hearingDate: string;
  hearingTime: string;
  purpose: string;
  briefUrl: string | null;
  briefNotes: string | null;
  status: CoverageStatus;
  requestedBy: string;
  requestedByName: string | null;
  claimedBy: string | null;
  claimedByName: string | null;
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
}

export interface CreateCoverageInput {
  hearingId?: string;
  caseId?: string;
  caseLabel?: string;
  court?: string;
  hearingDate?: string;
  hearingTime?: string;
  purpose?: string;
  briefUrl?: string;
  briefNotes?: string;
}

const KEY = ['coverage'] as const;

export function useCoverageList(status?: CoverageStatus) {
  return useQuery({
    queryKey: status ? [...KEY, status] : KEY,
    queryFn: () => api.get<{ items: CoverageRequest[] }>('/coverage', status ? { status } : undefined)
      .then((r) => r.items),
  });
}

export function useCoverageRequest(id: string | null) {
  return useQuery({
    queryKey: [...KEY, 'one', id ?? ''],
    queryFn: () => api.get<CoverageRequest>(`/coverage/${id}`),
    enabled: !!id,
  });
}

export function useCreateCoverage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCoverageInput) => api.post<CoverageRequest>('/coverage', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useClaimCoverage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<CoverageRequest>(`/coverage/${id}/claim`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCancelCoverage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<CoverageRequest>(`/coverage/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCompleteCoverage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<CoverageRequest>(`/coverage/${id}/complete`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
