import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// Mirrors apps/api/src/types/practice-analytics.types.ts. Duplicated here
// rather than promoted to @lexdraft/types because the API contract is
// still in flux (per-member figures will tighten once `cases.assignee`
// lands — see the practice-analytics service notes).

export interface WorkloadMember {
  userId: string;
  name: string;
  role: string;
  openMatters: number;
  hearingsThisWeek: number;
  hearingsNextWeek: number;
  openTasks: number;
  isOverloaded: boolean;
}

export interface WorkloadResponse {
  members: WorkloadMember[];
  totals: {
    activeMatters: number;
    hearingsThisWeek: number;
    hearingsNextWeek: number;
    memberCount: number;
  };
}

export interface ProfitabilityMatter {
  caseId: string;
  title: string;
  client: string;
  invoicedInr: number;
  paidInr: number;
  expensesInr: number;
  netInr: number;
  marginPct: number | null;
  isUnprofitable: boolean;
  lastInvoiceAt: string | null;
}

export interface ProfitabilityResponse {
  matters: ProfitabilityMatter[];
}

export const practiceAnalyticsKeys = {
  workload: () => ['practice-analytics', 'workload'] as const,
  profitability: (since?: string) => ['practice-analytics', 'profitability', since ?? null] as const,
};

export function usePracticeWorkload() {
  return useQuery({
    queryKey: practiceAnalyticsKeys.workload(),
    queryFn: () => api.get<WorkloadResponse>('/practice-analytics/workload'),
  });
}

export function usePracticeProfitability(opts: { since?: string } = {}) {
  const since = opts.since;
  return useQuery({
    queryKey: practiceAnalyticsKeys.profitability(since),
    queryFn: () =>
      api.get<ProfitabilityResponse>(
        '/practice-analytics/profitability',
        since ? { since } : undefined,
      ),
  });
}
