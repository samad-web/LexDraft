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

/** Fetch one document including its uploaded file blob (if any). The list
 *  endpoint omits the base64 to keep payloads small; this hook is for the
 *  viewer modal which actually needs the file content. */
export function useDocument(id: string | null) {
  return useQuery({
    enabled: !!id,
    queryKey: ['document', id],
    queryFn: () => api.get<DocumentRecord>(`/documents/${id}`),
    // Documents (including their file blobs) don't change often; cache the
    // base64 so reopening the viewer is instant.
    staleTime: 5 * 60 * 1000,
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
