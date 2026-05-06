import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Case } from '@lexdraft/types';
import { api } from '@/lib/api';

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
    queryFn: () => api.get<Case>(`/cases/${id}`),
    enabled: !!id,
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
