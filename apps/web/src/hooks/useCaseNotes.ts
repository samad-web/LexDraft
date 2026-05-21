import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CaseNote,
  CaseNoteVisibility,
  CreateTypedNoteRequest,
  FinalizeUploadedNoteRequest,
  UpdateCaseNoteRequest,
} from '@lexdraft/types';
import { api } from '@/lib/api';

// =============================================================================
// Case-notes hooks. Mirrors the documents flow:
//   - useCaseNotes(caseId) lists notes for a matter
//   - useCreateTypedNote() saves a typed note
//   - useUploadCaseNote() does the two-step presigned upload + finalize
//   - useUpdateCaseNote() / useDeleteCaseNote() are author-only on the server
//
// Note ordering, visibility filtering (shared + own-private), and edit/delete
// authority all live server-side - the client just renders what comes back.
// =============================================================================

interface UploadUrlResponse {
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
  requiredContentType: string;
}

export function useCaseNotes(caseId: string | null | undefined) {
  return useQuery({
    queryKey: ['case-notes', caseId],
    queryFn: () => api.get<{ items: CaseNote[] }>('/case-notes', { caseId: caseId! }),
    select: (r) => r.items,
    enabled: !!caseId,
  });
}

export function useCreateTypedNote(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTypedNoteRequest) =>
      api.post<CaseNote>('/case-notes', { caseId, ...input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['case-notes', caseId] }),
  });
}

export function useUpdateCaseNote(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateCaseNoteRequest }) =>
      api.patch<CaseNote>(`/case-notes/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['case-notes', caseId] }),
  });
}

export function useDeleteCaseNote(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/case-notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['case-notes', caseId] }),
  });
}

/**
 * Two-step upload of a notes file. Same shape as useUploadLetterheadLogo:
 *   1. Server signs a PUT URL for the supported mime
 *   2. Client PUTs the file
 *   3. Caller POSTs /case-notes/finalize so the server stores the row +
 *      runs text extraction. Resolves to the persisted note.
 */
export function useUploadCaseNote(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      file: File;
      title?: string;
      visibility?: CaseNoteVisibility;
    }): Promise<CaseNote> => {
      const mime = input.file.type || 'application/octet-stream';
      const presign = await api.post<UploadUrlResponse>('/case-notes/upload-url', {
        caseId,
        fileName: input.file.name,
        fileMime: mime,
        fileSize: input.file.size,
      });
      const putRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': presign.requiredContentType },
        body: input.file,
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed (${putRes.status})`);
      }
      const finalizePayload: FinalizeUploadedNoteRequest & { caseId: string } = {
        caseId,
        storageKey: presign.storageKey,
        fileName: input.file.name,
        fileMime: mime,
        fileSize: input.file.size,
        ...(input.title ? { title: input.title } : {}),
        ...(input.visibility ? { visibility: input.visibility } : {}),
      };
      return api.post<CaseNote>('/case-notes/finalize', finalizePayload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['case-notes', caseId] }),
  });
}
