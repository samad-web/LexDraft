import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CaseApplication, ApplicationKind, ApplicationStatus } from '@lexdraft/types';
import { api } from '@/lib/api';

// First-class applications on a matter — interim applications, appeals,
// execution, review, bail. Each carries its own status lifecycle.

export interface ApplicationInput {
  kind: ApplicationKind;
  label?: string | null;
  appType?: string | null;
  filedOn?: string | null;
  status?: ApplicationStatus;
  orderOn?: string | null;
  notes?: string | null;
  visibleToPortal?: boolean;
}

export function useCaseApplications(id: string | null | undefined) {
  return useQuery({
    queryKey: ['cases', id, 'applications'],
    queryFn: () => api.get<{ items: CaseApplication[] }>(`/cases/${id}/applications`),
    select: (r) => r.items,
    enabled: !!id,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>, caseId: string) {
  qc.invalidateQueries({ queryKey: ['cases', caseId, 'applications'] });
  // Applications surface as diary entries too.
  qc.invalidateQueries({ queryKey: ['cases', caseId, 'timeline'] });
}

export function useCreateApplication(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApplicationInput) =>
      api.post<CaseApplication>(`/cases/${caseId}/applications`, input),
    onSuccess: () => invalidate(qc, caseId),
  });
}

export function useUpdateApplication(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, patch }: { appId: string; patch: Partial<ApplicationInput> }) =>
      api.patch<CaseApplication>(`/cases/${caseId}/applications/${appId}`, patch),
    onSuccess: () => invalidate(qc, caseId),
  });
}

export function useDeleteApplication(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) =>
      api.delete<void>(`/cases/${caseId}/applications/${appId}`),
    onSuccess: () => invalidate(qc, caseId),
  });
}
