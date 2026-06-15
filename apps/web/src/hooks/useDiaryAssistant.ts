import { useMutation, useQuery } from '@tanstack/react-query';
import type { DiaryAssistantProposal, DiaryBriefing, JudgmentInsight } from '@lexdraft/types';
import { api } from '@/lib/api';

/** Parse a natural-language command into a proposed action. The mutation
 *  returns a proposal the caller renders as an editable confirmation card — no
 *  write happens here. */
export function useParseCommand() {
  return useMutation({
    mutationFn: (text: string) => api.post<DiaryAssistantProposal>('/diary-assistant/parse', { text }),
  });
}

/** Today/week briefing. Lazily enabled (so opening the Diary doesn't spend AI
 *  quota) — pass `enabled` once the user asks for it. */
export function useBriefing(range: 'today' | 'week', enabled: boolean) {
  return useQuery({
    queryKey: ['diary-assistant', 'briefing', range],
    queryFn: () => api.get<DiaryBriefing>('/diary-assistant/briefing', { range }),
    enabled,
    // The briefing is a point-in-time digest; don't silently refetch in the
    // background. The card has an explicit refresh button.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** Analyze the judgment PDF attached to a diary entry. Pass `force: true` to
 *  bypass the cache and re-run the analysis (overwrites the cached row). */
export function useAnalyzeJudgment() {
  return useMutation({
    mutationFn: ({ entryId, force = false }: { entryId: string; force?: boolean }) =>
      api.post<JudgmentInsight>(`/diary-assistant/judgment/${entryId}/analyze${force ? '?force=1' : ''}`, {}),
  });
}
