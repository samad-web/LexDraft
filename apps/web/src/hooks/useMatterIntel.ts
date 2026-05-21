import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MatterBrief,
  MatterDocument,
  MatterDocumentSummary,
} from '@lexdraft/types';
import { api } from '@/lib/api';

// =============================================================================
// Matter Intelligence — ingestion + summarisation + brief synthesis hooks.
//
// Companion hook file (useMatterChat.ts) covers the chat surface.
//
// Query-key convention:
//   ['matter-intel', 'documents', caseId]            — list of ingested docs
//   ['matter-intel', 'document', matterDocumentId]   — single doc + summary
//   ['matter-intel', 'brief', caseId]                — current matter brief
//
// Status polling:
//   Ingest returns a row with status='pending'. The processing pipeline
//   (extract → chunk → embed → summarise) finishes asynchronously for
//   large files. The list query polls every 4s while any document is in
//   a transient state ('pending' | 'extracting' | 'embedding') so the
//   UI ticks over to 'ready' without a manual refresh.
// =============================================================================

const POLL_INTERVAL_MS = 4_000;
const TRANSIENT_STATES = new Set(['pending', 'extracting', 'embedding']);

interface UploadUrlResponse {
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
  requiredContentType: string;
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

/** Documents ingested into matter intelligence for `caseId`. The list query
 *  re-polls every 4s while any row is still in a transient state so the
 *  status chip flips automatically when the background pipeline lands. */
export function useMatterDocuments(caseId: string | null | undefined) {
  return useQuery({
    queryKey: ['matter-intel', 'documents', caseId],
    queryFn: () =>
      api.get<{ items: Array<MatterDocument & { summary?: MatterDocumentSummary }> }>(
        `/matter-intel/${caseId}/documents`,
      ),
    select: (r) => r.items,
    enabled: !!caseId,
    refetchInterval: (q) => {
      const items = (q.state.data as { items?: MatterDocument[] } | undefined)?.items ?? [];
      const anyTransient = items.some((d) => TRANSIENT_STATES.has(d.status));
      return anyTransient ? POLL_INTERVAL_MS : false;
    },
  });
}

export function useMatterDocument(matterDocumentId: string | null | undefined) {
  return useQuery({
    queryKey: ['matter-intel', 'document', matterDocumentId],
    queryFn: () =>
      api.get<MatterDocument & { summary?: MatterDocumentSummary }>(
        `/matter-intel/documents/${matterDocumentId}`,
      ),
    enabled: !!matterDocumentId,
    // Same polling story as the list — a single-document view is the place
    // an advocate sits while waiting for AI summarisation to finish.
    refetchInterval: (q) => {
      const d = q.state.data as MatterDocument | undefined;
      return d && TRANSIENT_STATES.has(d.status) ? POLL_INTERVAL_MS : false;
    },
  });
}

// ---------------------------------------------------------------------------
// Upload (presigned PUT → server finalize)
// ---------------------------------------------------------------------------

/**
 * Multi-file upload mutation. The server signs each PUT URL independently,
 * the browser PUTs each file directly to storage, and the server then
 * finalises one at a time. Failures on individual files are returned in
 * `failures`; the caller decides whether to surface a partial-success
 * toast or retry.
 */
export function useUploadMatterDocuments(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      files: File[],
    ): Promise<{ ingested: MatterDocument[]; failures: Array<{ fileName: string; error: string }> }> => {
      const ingested: MatterDocument[] = [];
      const failures: Array<{ fileName: string; error: string }> = [];
      for (const file of files) {
        const mime = file.type || 'application/octet-stream';
        try {
          const presign = await api.post<UploadUrlResponse>(
            `/matter-intel/${caseId}/upload-url`,
            { fileName: file.name, fileMime: mime, fileSize: file.size },
          );
          const putRes = await fetch(presign.uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': presign.requiredContentType },
            body: file,
          });
          if (!putRes.ok) {
            throw new Error(`Upload PUT failed (${putRes.status})`);
          }
          const doc = await api.post<MatterDocument>(`/matter-intel/${caseId}/upload`, {
            storageKey: presign.storageKey,
            fileName: file.name,
            fileMime: mime,
            fileSize: file.size,
          });
          ingested.push(doc);
        } catch (err) {
          failures.push({ fileName: file.name, error: err instanceof Error ? err.message : 'Upload failed' });
        }
      }
      return { ingested, failures };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matter-intel', 'documents', caseId] }),
  });
}

/** Pull an existing `documents` row into matter intelligence. The blob is
 *  shared (no copy); the chunks + summary are matter-intel-specific. */
export function usePullMatterDocument(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) =>
      api.post<MatterDocument>(`/matter-intel/${caseId}/pull/${documentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matter-intel', 'documents', caseId] }),
  });
}

// ---------------------------------------------------------------------------
// Summary (regenerate)
// ---------------------------------------------------------------------------

export function useSummariseMatterDocument(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (matterDocumentId: string) =>
      api.post<MatterDocumentSummary>(`/matter-intel/documents/${matterDocumentId}/summarise`),
    onSuccess: (_summary, matterDocumentId) => {
      qc.invalidateQueries({ queryKey: ['matter-intel', 'document', matterDocumentId] });
      qc.invalidateQueries({ queryKey: ['matter-intel', 'documents', caseId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------

/**
 * Current matter brief (the non-superseded row). Returns null when no brief
 * has been generated yet — the UI uses that as the signal to render the
 * "Generate your first brief" empty state.
 */
export function useMatterBrief(caseId: string | null | undefined) {
  return useQuery({
    queryKey: ['matter-intel', 'brief', caseId],
    queryFn: async () => {
      try {
        return await api.get<MatterBrief>(`/matter-intel/${caseId}/brief`);
      } catch (err) {
        // 404 = no brief yet; surface as null rather than an error so the
        // empty-state path is the same as "brief deleted, please regenerate".
        if ((err as { response?: { status?: number } })?.response?.status === 404) {
          return null;
        }
        throw err;
      }
    },
    enabled: !!caseId,
  });
}

export function useRegenerateMatterBrief(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<MatterBrief>(`/matter-intel/${caseId}/brief/regenerate`),
    // Optimistic: stash the freshly-returned brief into the cache so the
    // UI flips immediately rather than waiting for the invalidation refetch.
    onSuccess: (brief) => {
      qc.setQueryData(['matter-intel', 'brief', caseId], brief);
    },
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export function useRemoveMatterDocument(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (matterDocumentId: string) =>
      api.delete<void>(`/matter-intel/documents/${matterDocumentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matter-intel', 'documents', caseId] }),
  });
}

// ---------------------------------------------------------------------------
// Quick studies — sandbox matters for ad-hoc upload-and-ask flows.
// ---------------------------------------------------------------------------

export interface QuickStudy {
  id: string;
  title: string;
  createdAt: string;
  documentCount: number;
}

export function useQuickStudies() {
  return useQuery({
    queryKey: ['matter-intel', 'quick-studies'],
    queryFn: () => api.get<{ items: QuickStudy[] }>('/matter-intel/quick-studies'),
    select: (r) => r.items,
  });
}

export function useCreateQuickStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string } = {}) =>
      api.post<{ id: string; title: string; createdAt: string }>(
        '/matter-intel/quick-studies',
        input,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matter-intel', 'quick-studies'] }),
  });
}
