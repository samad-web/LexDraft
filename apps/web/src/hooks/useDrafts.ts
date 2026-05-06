import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SavedDraft, SaveDraftRequest } from '@lexdraft/types';
import { api } from '@/lib/api';

const KEY = ['drafts'] as const;

export function useSavedDrafts() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<{ items: SavedDraft[] }>('/drafts').then((r) => r.items),
  });
}

export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: SaveDraftRequest }) =>
      id
        ? api.put<SavedDraft>(`/drafts/${id}`, body)
        : api.post<SavedDraft>('/drafts', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useDeleteDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/drafts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useDraft(id: string | null) {
  return useQuery({
    queryKey: ['draft', id],
    queryFn: () => api.get<SavedDraft>(`/drafts/${id}`),
    enabled: !!id,
  });
}
