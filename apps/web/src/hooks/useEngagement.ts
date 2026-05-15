import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Engagement-letter hooks - Firm-tier feature. Types are kept local to the
 * web app for now (mirror of `apps/api/src/types/engagement.types.ts`); the
 * orchestrator will hoist them into `@lexdraft/types` when the feature
 * graduates from preview.
 */

export interface EngagementTemplate {
  id: string;
  firmId: string;
  matterType: string;
  scopeClauses: string;
  feeClauses: string;
  retainerInr: number | null;
  notes: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface EngagementTemplateGroup {
  matterType: string;
  templates: EngagementTemplate[];
}

export interface ListEngagementTemplatesResponse {
  items: EngagementTemplate[];
  groups: EngagementTemplateGroup[];
}

export interface CreateEngagementTemplateRequest {
  matterType: string;
  scopeClauses: string;
  feeClauses: string;
  retainerInr?: number | null;
  notes?: string | null;
  isDefault?: boolean;
}

export type UpdateEngagementTemplateRequest = Partial<CreateEngagementTemplateRequest>;

export interface GenerateEngagementLetterResponse {
  text: string;
  generatedAt: string;
  templateId: string;
  matterType: string;
}

const KEY = ['engagement', 'templates'] as const;

export function useEngagementTemplates() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<ListEngagementTemplatesResponse>('/engagement/templates'),
  });
}

export function useCreateEngagementTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEngagementTemplateRequest) =>
      api.post<EngagementTemplate>('/engagement/templates', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateEngagementTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateEngagementTemplateRequest }) =>
      api.patch<EngagementTemplate>(`/engagement/templates/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteEngagementTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/engagement/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useGenerateEngagementLetter() {
  return useMutation({
    mutationFn: (input: { caseId: string; templateId?: string }) =>
      api.post<GenerateEngagementLetterResponse>('/engagement/generate', input),
  });
}
