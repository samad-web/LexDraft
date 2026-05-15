import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Limitation,
  LimitationCalculateRequest,
  LimitationCalculation,
  LimitationFilingType,
} from '@lexdraft/types';
import { api } from '@/lib/api';

/**
 * Public shape of a saved limitation row. Mirrors @lexdraft/types' Limitation
 * but tacks on the statute-aware metadata (migration 0022) the server now
 * returns. Defined locally so we don't have to round-trip a shared-types PR.
 */
export interface LimitationRow extends Limitation {
  matterType?: string | null;
  basisStatute?: string | null;
  basisSection?: string | null;
  computedFrom?: string | null;
}

export interface CreateLimitationInput extends Omit<Limitation, 'id' | 'daysRemaining'> {
  matterType?: string;
  basisStatute?: string;
  basisSection?: string;
  computedFrom?: string;
}

export interface LimitationRule {
  matterType: string;
  statute: string;
  section: string;
  periodMonths: number;
  periodDays?: number;
  computedFrom: string;
  notes?: string;
}

export interface ComputeDeadlineResult {
  matterType: string;
  basisStatute: string;
  basisSection: string;
  deadline: string;
  daysRemaining: number;
  computedFrom: string;
  notes?: string;
}

export function useLimitations() {
  return useQuery({
    queryKey: ['limitations'],
    queryFn: () => api.get<{ items: LimitationRow[] }>('/limitations'),
    select: (r) => r.items,
  });
}

export function useCreateLimitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLimitationInput) =>
      api.post<LimitationRow>('/limitations', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['limitations'] }),
  });
}

export function useLimitationFilingTypes() {
  return useQuery({
    queryKey: ['limitations', 'calculator', 'types'],
    queryFn: () => api.get<{ items: LimitationFilingType[] }>('/limitations/calculator/types'),
    select: (r) => r.items,
    // Catalog is static - refresh once per session, not on focus.
    staleTime: 60 * 60 * 1000,
  });
}

export function useCalculateLimitation() {
  return useMutation({
    mutationFn: (input: LimitationCalculateRequest) =>
      api.post<LimitationCalculation>('/limitations/calculator/calculate', input),
  });
}

// ---- Matter-type rules (statute-aware engine, migration 0022) -------------

export function useLimitationRules() {
  return useQuery({
    queryKey: ['limitations', 'rules'],
    queryFn: () => api.get<{ items: LimitationRule[] }>('/limitations/rules'),
    select: (r) => r.items,
    // Rules are curated static data - cache aggressively.
    staleTime: 60 * 60 * 1000,
  });
}

export function useComputeFromRule() {
  return useMutation({
    mutationFn: (input: { matterType: string; computedFrom: string }) =>
      api.post<ComputeDeadlineResult>('/limitations/rules/compute', input),
  });
}
