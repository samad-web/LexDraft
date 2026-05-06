import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Clause, CreateClauseRequest, ImportClausesResult, UpdateClauseRequest,
} from '@lexdraft/types';
import { api } from '@/lib/api';

export const clauseKeys = {
  list: (filter?: object) => ['clauses', filter] as const,
};

export function useClauses(filter: { category?: string; q?: string } = {}) {
  return useQuery({
    queryKey: clauseKeys.list(filter),
    queryFn: () => api.get<{ items: Clause[] }>('/clauses', filter as Record<string, unknown>),
    select: (r) => r.items,
  });
}

export function useCreateClause() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateClauseRequest) => api.post<Clause>('/clauses', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clauses'] }),
  });
}

export function useUpdateClause() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateClauseRequest }) =>
      api.patch<Clause>(`/clauses/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clauses'] }),
  });
}

export function useDeleteClause() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/clauses/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clauses'] }),
  });
}

export function useIncrementClauseUses() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/clauses/${id}/use`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clauses'] }),
  });
}

export function useImportClauses() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: CreateClauseRequest[]) =>
      api.post<ImportClausesResult>('/clauses/import', { items }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clauses'] }),
  });
}
