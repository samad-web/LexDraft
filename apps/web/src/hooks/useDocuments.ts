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

/** Fetch a short-lived presigned download URL for a document's attached
 *  storage object. Used by the viewer when the file lives in S3 / local
 *  storage instead of inline base64. */
export function useDocumentDownloadUrl(id: string | null, enabled: boolean) {
  return useQuery({
    enabled: !!id && enabled,
    queryKey: ['document', id, 'download-url'],
    queryFn: () =>
      api.get<{ downloadUrl: string; expiresAt: string }>(`/documents/${id}/download-url`),
    // Presigned URLs are short-lived (5 min by default in the API). Refresh
    // before they expire by capping staleTime well under that window.
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Extracted text of every document filed against a case label. Used when
 * drafting FOR a case so the engine reads the matter's papers (cheque, notice,
 * agreement) without the advocate re-attaching them. The server extracts on the
 * fly (OCR for scans), so this can be slow for scan-heavy matters - hence a
 * generous staleTime so it isn't re-fetched on every keystroke.
 */
export interface CaseDocumentText {
  items: Array<{ name: string; text: string }>;
  /** Documents attached to the case whose bytes couldn't be read (never
   *  stored, or extraction produced nothing) — surface these so the advocate
   *  knows to re-upload them rather than assuming the engine has their content. */
  unreadable: string[];
}

export function useCaseDocumentText(caseLabel: string | null | undefined) {
  return useQuery({
    enabled: !!caseLabel && caseLabel.trim().length > 0,
    queryKey: ['documents', 'case-text', caseLabel],
    queryFn: () =>
      api.get<CaseDocumentText>('/documents/case-text', { case: caseLabel! }),
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

export interface UpdateDocumentPatch {
  name?: string;
  type?: string;
  case?: string;
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDocumentPatch }) =>
      api.patch<DocumentRecord>(`/documents/${id}`, patch),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['document', vars.id] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/documents/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
