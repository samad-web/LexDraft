import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface UsageInfo {
  aiDocuments: {
    used: number;
    /** null = unlimited (Firm tier). */
    limit: number | null;
  };
}

export function useMyUsage() {
  return useQuery({
    queryKey: ['me', 'usage'],
    queryFn: () => api.get<UsageInfo>('/me/usage'),
    staleTime: 60_000,
  });
}
