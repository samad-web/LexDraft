import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PhysicalDocument,
  CreatePhysicalDocumentRequest,
  UpdatePhysicalDocumentRequest,
} from '@lexdraft/types';
import { api } from '@/lib/api';

const KEY = ['physical-documents'] as const;

export function usePhysicalDocuments(filters?: { status?: string; q?: string }) {
  return useQuery({
    queryKey: [...KEY, filters?.status ?? 'all', filters?.q ?? ''],
    queryFn: () => api.get<{ items: PhysicalDocument[] }>('/physical-documents', filters as Record<string, unknown>),
    select: (d) => d.items,
  });
}

export function useCreatePhysicalDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePhysicalDocumentRequest) =>
      api.post<PhysicalDocument>('/physical-documents', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdatePhysicalDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; patch: UpdatePhysicalDocumentRequest }) =>
      api.patch<PhysicalDocument>(`/physical-documents/${vars.id}`, vars.patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeletePhysicalDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<void>(`/physical-documents/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
