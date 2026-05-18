import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// Wire-shape mirrors LawHit from apps/api/src/services/laws-search.service.ts.
// Keeping the types here (rather than importing from @lexdraft/types) so the
// API and the web can evolve the corpus contract independently of the
// public type package.

export interface LawHit {
  id: string;
  content: string;
  sectionId: string | null;
  actId: string | null;
  citation: string | null;
  sectionNumber: string | null;
  sectionHeading: string | null;
  actTitle: string | null;
  pdfStoragePath: string | null;
  sourceUrl: string | null;
  score: number;
  rerankScore?: number;
}

export interface LawsSearchRequest {
  query: string;
  actId?: string;
  k?: number;
  rerank?: boolean;
}

export interface LawsSearchResponse {
  query: string;
  results: LawHit[];
}

export interface LawsLookupRequest {
  act: string;
  section: string;
  k?: number;
}

/**
 * One-shot hybrid search over the indiacode-rag corpus. Use as a mutation
 * (Research view "Search" button) when the user hits enter; use the
 * `useLawsSearchSuggestions` query hook below for the drafting side-panel
 * which re-fires as the user types.
 */
export function useLawsSearch() {
  return useMutation<LawsSearchResponse, Error, LawsSearchRequest>({
    mutationFn: (body) => api.post<LawsSearchResponse>('/laws/search', body),
  });
}

/**
 * Reactive variant for live recommendations (side panels). Reads the same
 * /laws/search endpoint but as a Query so react-query handles caching,
 * dedup, and cleanup. Pass an empty `query` to keep the request disabled.
 */
export function useLawsSearchSuggestions(query: string, opts?: { k?: number; rerank?: boolean }) {
  const trimmed = query.trim();
  return useQuery<LawsSearchResponse>({
    queryKey: ['laws', 'search', trimmed, opts?.k ?? 8, opts?.rerank ?? false],
    queryFn: () =>
      api.post<LawsSearchResponse>('/laws/search', {
        query: trimmed,
        k: opts?.k ?? 8,
        rerank: opts?.rerank ?? false,
      }),
    enabled: trimmed.length >= 3,
    // The API caches by query for 60s; matching that here means the
    // panel doesn't refire when the user re-focuses.
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    // The side-panel must never block the page, even if the corpus
    // is misconfigured. Surface the error in the panel locally.
    retry: false,
  });
}

/** Direct "BNS 103"-style lookup. Skips the embedding step. */
export function useLawsLookup() {
  return useMutation<LawsSearchResponse, Error, LawsLookupRequest>({
    mutationFn: (body) =>
      api.post<LawsSearchResponse>('/laws/lookup', body).then((r) => ({
        // Lookup returns { act, section, results }; reshape to match search.
        query: `${body.act} ${body.section}`,
        results: (r as unknown as { results: LawHit[] }).results,
      })),
  });
}

/**
 * Mints a signed URL for a chunk's source PDF. Cached aggressively (1h)
 * since the backend mints with a 1h TTL by default; on the second click
 * we re-fetch a fresh one well before expiry.
 */
export function useSignedPdfUrl() {
  const qc = useQueryClient();
  return async (storagePath: string): Promise<string | null> => {
    const cached = qc.getQueryData<{ url: string; mintedAt: number }>(['laws', 'pdf', storagePath]);
    if (cached && Date.now() - cached.mintedAt < 50 * 60_000) return cached.url;
    const r = await api.post<{ url: string }>('/laws/pdf-url', { storagePath });
    qc.setQueryData(['laws', 'pdf', storagePath], { url: r.url, mintedAt: Date.now() });
    return r.url;
  };
}
