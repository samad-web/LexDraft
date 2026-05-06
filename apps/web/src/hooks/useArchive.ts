import { useQuery } from '@tanstack/react-query';
import type { ArchivedMatter } from '@lexdraft/types';
import { api } from '@/lib/api';

export function useArchive() {
  return useQuery({
    queryKey: ['archive'],
    queryFn: () => api.get<{ items: ArchivedMatter[] }>('/archive'),
    select: (r) => r.items,
  });
}
