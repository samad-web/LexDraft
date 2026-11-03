import { useMutation, useQuery } from '@tanstack/react-query';
import type { ResearchAnswer } from '@lexdraft/types';
import { api } from '@/lib/api';

export function useAskResearch() {
  return useMutation({
    mutationFn: (q: string) => api.get<ResearchAnswer>('/research', { q }),
  });
}

/** Whether Ask Lex.AI can answer on this deployment. Unknown (older API, error)
 *  reads as yes, so the screen behaves as it always did. */
export function useResearchStatus() {
  return useQuery({
    queryKey: ['research-status'],
    queryFn: () => api.get<{ ask: boolean }>('/research/status'),
    retry: false,
    staleTime: 10 * 60_000,
  });
}
