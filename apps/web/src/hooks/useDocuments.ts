import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentRecord } from '@lexdraft/types';
import { api } from '@/lib/api';

export function useDocuments() {
  return useQuery({
    queryKey: ['documents'],
    queryFn: () => api.get<{ items: DocumentRecord[] }>('/documents'),
    select: (r) => r.items,
  });
}

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<DocumentRecord, 'id'>) =>
      api.post<DocumentRecord>('/documents', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  });
}
