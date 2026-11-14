import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreditBalance } from '@lexdraft/types';
import { api } from '@/lib/api';

/** The firm's AI credits (/api/credits). Refreshed after every AI action that
 *  goes through `refreshCredits`, and on window focus. */
export function useCredits() {
  return useQuery({
    queryKey: ['credits'],
    queryFn: () => api.get<CreditBalance>('/credits'),
    staleTime: 30_000,
  });
}

/** Pays the locked rest of a draft. Plain-text drafts come back with `text`
 *  (or `rec` for pipeline blocks); intake drafts are re-loaded by the caller. */
export function useUnlockDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draftKey: string) =>
      api.post<{ unlocked: true; text?: string; rec?: Record<string, string> }>('/credits/unlock', { draftKey }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['credits'] }),
  });
}
