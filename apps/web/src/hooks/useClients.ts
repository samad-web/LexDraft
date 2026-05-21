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

export type ClientUpdate = Partial<Omit<Client, 'id' | 'mattersOpen' | 'portalEnabled'>>;

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ClientUpdate }) =>
      api.patch<Client>(`/clients/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      // Cases list shows the freeform client string — if the user renamed
      // a client the matter counts on the Cases view should re-render.
      qc.invalidateQueries({ queryKey: ['cases'] });
    },
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/clients/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['cases'] });
    },
  });
}
