import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Limitation } from '@lexdraft/types';
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
