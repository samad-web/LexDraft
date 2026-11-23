import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DocumentRecord, SavedDraft } from '@lexdraft/types';
import { api } from '@/lib/api';

/** POST /drafting/document/open (import-edit-document). */
export interface OpenedDocument {
  blocks: Array<{ key: string; text: string; align?: string; bold?: boolean; table?: boolean }>;
  docxBase64: string | null;
  kind: 'docx' | 'pdf';
  warnings: string[];
  sourceDocumentId: string;
  title: string;
  docType: string;
  matter: string;
}

export type OpenDocumentInput =
  | { documentId: string }
  | { fileName: string; fileBase64: string; matter: string; docType: string };

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['documents'] });
    void qc.invalidateQueries({ queryKey: ['drafts'] });
  };
}

export function useOpenDocument() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: OpenDocumentInput) => api.post<OpenedDocument>('/drafting/document/open', input),
    // a new upload files its original into Documents
    onSuccess: (_r, input) => { if (!('documentId' in input)) invalidate(); },
  });
}

/** The edited Word copy into Documents (one row per draft, replaced each save). */
export function useSaveEditedFile() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ draftId, paragraphs }: { draftId: string; paragraphs: string[] }) =>
      api.put<DocumentRecord>(`/drafts/${draftId}/edited-file`, { paragraphs }),
    onSuccess: invalidate,
  });
}

/** Option A: an independent copy (draft + its files) in another case. */
export function useCopyDraftToCase() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ draftId, matter }: { draftId: string; matter: string }) =>
      api.post<SavedDraft>(`/drafts/${draftId}/copy`, { matter }),
    onSuccess: invalidate,
  });
}

/** "Add to a case": the draft, its edited file and an unfiled original move. */
export function useMoveDraftToCase() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ draftId, matter }: { draftId: string; matter: string }) =>
      api.patch<SavedDraft>(`/drafts/${draftId}/matter`, { matter }),
    onSuccess: invalidate,
  });
}
