import { useQuery } from '@tanstack/react-query';
import type { DashboardSummary } from '@lexdraft/types';
import { api } from '@/lib/api';

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardSummary>('/dashboard'),
  });
}
