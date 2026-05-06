import { useMutation } from '@tanstack/react-query';
import type { ResearchAnswer } from '@lexdraft/types';
import { api } from '@/lib/api';

export function useAskResearch() {
  return useMutation({
    mutationFn: (q: string) => api.get<ResearchAnswer>('/research', { q }),
  });
}
