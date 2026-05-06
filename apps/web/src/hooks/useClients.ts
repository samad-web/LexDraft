import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Client } from '@lexdraft/types';
import { api } from '@/lib/api';

export function useClients() {
  return useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get<{ items: Client[] }>('/clients'),
    select: (r) => r.items,
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Client, 'id' | 'mattersOpen'>) =>
      api.post<Client>('/clients', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}
