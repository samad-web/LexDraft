import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TeamMemberWorkload } from '@lexdraft/types';
import { api } from '@/lib/api';

/** Each member's live workload (team-work.md). */
export function useTeamWorkload(enabled = true) {
  return useQuery({
    queryKey: ['firm', 'team'],
    queryFn: () => api.get<{ items: TeamMemberWorkload[] }>('/firm/team'),
    select: (r) => r.items,
    enabled,
  });
}

/** Make a member the lead on any case (Assign work → Case). */
export function useAssignCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, userId }: { caseId: string; userId: string }) => api.put(`/cases/${caseId}/lead`, { userId }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['cases', v.caseId, 'lead'] });
      void qc.invalidateQueries({ queryKey: ['firm', 'team'] });
    },
  });
}
