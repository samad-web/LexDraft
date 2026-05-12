import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Limitation,
  LimitationCalculateRequest,
  LimitationCalculation,
  LimitationFilingType,
} from '@lexdraft/types';
import { api } from '@/lib/api';

export function useLimitations() {
  return useQuery({
    queryKey: ['limitations'],
    queryFn: () => api.get<{ items: Limitation[] }>('/limitations'),
    select: (r) => r.items,
  });
}

export function useCreateLimitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Limitation, 'id' | 'daysRemaining'>) =>
      api.post<Limitation>('/limitations', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['limitations'] }),
  });
}

export function useLimitationFilingTypes() {
  return useQuery({
    queryKey: ['limitations', 'calculator', 'types'],
    queryFn: () => api.get<{ items: LimitationFilingType[] }>('/limitations/calculator/types'),
    select: (r) => r.items,
    // Catalog is static — refresh once per session, not on focus.
    staleTime: 60 * 60 * 1000,
  });
}

export function useCalculateLimitation() {
  return useMutation({
    mutationFn: (input: LimitationCalculateRequest) =>
      api.post<LimitationCalculation>('/limitations/calculator/calculate', input),
  });
}
