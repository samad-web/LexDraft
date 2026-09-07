import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Lead, LeadStage, ConflictStatus } from '@lexdraft/types';
import { api } from '@/lib/api';

/** Fields a caller may set when capturing or editing a lead. */
export type LeadInput = Omit<Lead, 'id' | 'capturedAt' | 'convertedClient'>;

/** Prefill returned by the retain endpoint to open a "New matter" form. */
export interface MatterPrefill {
  title: string;
  client: string;
  type: string;
  summary: string;
}

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
    mutationFn: (input: LeadInput) => api.post<Lead>('/leads', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

/** Patch any editable lead field (contact, value, probability, conflict, …). */
export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<LeadInput> }) =>
      api.patch<Lead>(`/leads/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['leads'] });
      const previous = qc.getQueryData<{ items: Lead[] }>(['leads']);
      if (previous) {
        qc.setQueryData<{ items: Lead[] }>(['leads'], {
          items: previous.items.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(['leads'], ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

/** Convenience: set the conflict-check outcome on a lead. */
export function useSetConflict() {
  const update = useUpdateLead();
  return {
    ...update,
    set: (id: string, conflictStatus: ConflictStatus) =>
      update.mutateAsync({ id, patch: { conflictStatus } }),
  };
}

/** Retain a lead → server creates/links the client and returns a matter prefill. */
export function useRetainLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ lead: Lead; matterPrefill: MatterPrefill }>(`/leads/${id}/retain`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
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
