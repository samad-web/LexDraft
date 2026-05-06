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

export function useCreateDiaryEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<DiaryEntry, 'id'>) => api.post<DiaryEntry>('/diary', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['diary'] }),
  });
}
