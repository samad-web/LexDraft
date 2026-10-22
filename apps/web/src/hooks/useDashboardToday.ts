import { useQuery } from '@tanstack/react-query';
import type { DashboardToday } from '@lexdraft/types';
import { api } from '@/lib/api';

/** The advocate's-day dashboard. Keyed under ['dashboard'] so anything that
 *  invalidates the dashboard refreshes this too. */
export function useDashboardToday() {
  return useQuery({
    queryKey: ['dashboard', 'today'],
    queryFn: () => api.get<DashboardToday>('/dashboard/today'),
    refetchInterval: 5 * 60 * 1000,
  });
}
