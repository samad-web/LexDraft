import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Lead, LeadStage } from '@lexdraft/types';
import { api } from '@/lib/api';

export function useLeads() {
  return useQuery({
    queryKey: ['leads'],
    queryFn: () => api.get<{ items: Lead[] }>('/leads'),
    select: (r) => r.items,
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Lead, 'id' | 'capturedAt'>) =>
      api.post<Lead>('/leads', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useMoveLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: LeadStage }) =>
      api.patch<Lead>(`/leads/${id}/stage`, { stage }),
    // Optimistic update so the card jumps columns immediately.
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ['leads'] });
      const previous = qc.getQueryData<{ items: Lead[] }>(['leads']);
      if (previous) {
        qc.setQueryData<{ items: Lead[] }>(['leads'], {
          items: previous.items.map((l) => (l.id === id ? { ...l, stage } : l)),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['leads'], ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/leads/${id}`),
    // Optimistic remove so the card disappears instantly.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['leads'] });
      const previous = qc.getQueryData<{ items: Lead[] }>(['leads']);
      if (previous) {
        qc.setQueryData<{ items: Lead[] }>(['leads'], {
          items: previous.items.filter((l) => l.id !== id),
        });
      }
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(['leads'], ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}
