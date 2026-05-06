import { useQuery } from '@tanstack/react-query';
import type { FirmDashboardSummary } from '@lexdraft/types';
import { api } from '@/lib/api';

export function useFirmDashboard() {
  return useQuery({
    queryKey: ['firm', 'dashboard'],
    queryFn: () => api.get<FirmDashboardSummary>('/firm/dashboard'),
  });
}
