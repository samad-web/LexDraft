import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMeFeatures } from './useFirmAdmin';
import { useAuthStore } from '@/store/auth';

// =============================================================================
// useAssignments — handover / assignment of matters and hearings.
//
// Backend: /firm/teammates, /cases/:id/lead, /hearings/:id/assignee
// (apps/api/src/services/assignments.service.ts). The server is the authority
// on who may reassign what; these hooks just surface the data + mutations and
// the client-side `useIsHead()` only decides how much of the picker to show.
// =============================================================================

export interface Teammate {
  id: string;
  name: string;
  email: string;
  role: string;
}

// Mirrors HEAD_ROLES in assignments.service.ts.
const HEAD_ROLES = new Set(['Firm Admin', 'Practice Group Lead', 'Managing Partner']);

/** True when the current user is a firm "head" (may assign anyone). */
export function useIsHead(): boolean {
  const features = useMeFeatures();
  const user = useAuthStore((s) => s.user);
  if (user?.isSuperadmin) return true;
  const roleName = features.data?.role?.name ?? user?.role ?? '';
  return HEAD_ROLES.has(roleName);
}

/** The current user's id (for "am I the lead?" self-handoff checks). */
export function useCurrentUserId(): string | null {
  return useAuthStore((s) => s.user?.id ?? null);
}

/** Active members of the firm — the assignment pool. */
export function useTeammates() {
  return useQuery({
    queryKey: ['firm', 'teammates'],
    queryFn: () => api.get<{ items: Teammate[] }>('/firm/teammates'),
    select: (r) => r.items,
    staleTime: 5 * 60_000,
  });
}

/** Current lead advocate on a matter. */
export function useCaseLead(caseId: string | undefined) {
  return useQuery({
    queryKey: ['cases', caseId, 'lead'],
    queryFn: () => api.get<{ lead: Teammate | null }>(`/cases/${caseId}/lead`),
    select: (r) => r.lead,
    enabled: !!caseId,
  });
}

/** Hand a matter to another member (set the lead). */
export function useSetCaseLead(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.put<{ lead: Teammate }>(`/cases/${caseId}/lead`, { userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cases', caseId, 'lead'] });
    },
  });
}

/** Current explicit assignee of a single hearing (null = falls back to lead). */
export function useHearingAssignee(hearingId: string | undefined) {
  return useQuery({
    queryKey: ['hearings', hearingId, 'assignee'],
    queryFn: () => api.get<{ assignee: Teammate | null }>(`/hearings/${hearingId}/assignee`),
    select: (r) => r.assignee,
    enabled: !!hearingId,
  });
}

/** Assign (userId) or clear (userId=null) a single hearing. */
export function useAssignHearing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { hearingId: string; userId: string | null }) =>
      api.put<{ assignee: Teammate | null }>(`/hearings/${args.hearingId}/assignee`, { userId: args.userId }),
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ['hearings', args.hearingId, 'assignee'] });
      qc.invalidateQueries({ queryKey: ['calendar'] });
    },
  });
}
