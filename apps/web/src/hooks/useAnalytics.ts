import { useQuery } from '@tanstack/react-query';
import type { AnalyticsSummary } from '@lexdraft/types';
import { api } from '@/lib/api';

export function useAnalytics() {
  return useQuery({
    queryKey: ['analytics'],
    queryFn: () => api.get<AnalyticsSummary>('/analytics'),
  });
}
