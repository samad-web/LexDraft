import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DiaryEntry } from '@lexdraft/types';
import { api } from '@/lib/api';

export function useDiary() {
  return useQuery({
    queryKey: ['diary'],
    queryFn: () => api.get<{ items: DiaryEntry[] }>('/diary'),
    select: (r) => r.items,
  });
}

export function useDiaryEntry(id: string | null) {
  return useQuery({
    queryKey: ['diary', id],
    queryFn: () => api.get<DiaryEntry>(`/diary/${id}`),
    enabled: !!id,
  });
}

export function useCreateDiaryEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<DiaryEntry, 'id'>) => api.post<DiaryEntry>('/diary', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['diary'] }),
  });
}

export function useUpdateDiaryEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Omit<DiaryEntry, 'id'>> }) =>
      api.patch<DiaryEntry>(`/diary/${id}`, patch),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['diary'] });
      void qc.invalidateQueries({ queryKey: ['diary', vars.id] });
    },
  });
}

export function useDeleteDiaryEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/diary/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['diary'] }),
  });
}
