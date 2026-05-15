/**
 * React Query bindings for the DPDP (Digital Personal Data Protection Act 2023)
 * data-principal endpoints under `/api/me/dpdp/*`.
 *
 * Backend contract lives in `apps/api/src/types/dpdp.types.ts`. Those types are
 * local to the api package today - the orchestrator will lift them into
 * `@lexdraft/types` once this UI lands. Until then the frontend redeclares the
 * minimal DTOs it actually renders.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiClient } from '@/lib/api';
import { triggerBlobDownload } from '@/lib/blob-download';

// -- local DTOs (mirror apps/api/src/types/dpdp.types.ts) ---------------------

export interface DeletionRequestResponse {
  /** ISO timestamp the row will be hard-deleted at. */
  scheduledPurgeAt: string;
  /** Retention window honoured. Default 30, capped at 365. */
  retentionDays: number;
  /** Alias for scheduledPurgeAt - the latest moment the user can cancel. */
  canCancelUntil: string;
}

export interface ConsentRecord {
  id: string;
  userId: string | null;
  firmId: string | null;
  consentType: string;
  consentVersion: string;
  granted: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface RecordConsentInput {
  consentType: string;
  consentVersion: string;
  granted: boolean;
}

export interface DeletionRequestInput {
  retentionDays?: number;
}

/**
 * Stable query key for the in-session deletion status. The backend does not
 * (yet) expose `GET /api/me/dpdp/deletion-status`, so the banner reads this
 * key - it gets populated by the request mutation and cleared by the cancel
 * mutation. Persists for the React Query cache lifetime (i.e. this tab).
 */
export const DELETION_STATUS_KEY = ['dpdp', 'deletion-status'] as const;

// -- export -------------------------------------------------------------------

export function useExportMyData() {
  return useMutation({
    mutationFn: async () => {
      // The API streams the JSON dump as an attachment; we receive it as a
      // blob and trigger the same `<a download>` flow used by the invoice CSV
      // export. The filename mirrors what the server's Content-Disposition
      // sets (the browser would honour that for top-level navigations, but
      // for a fetch we have to set it client-side).
      const resp = await apiClient.get('/api/me/dpdp/export', {
        responseType: 'blob',
      });
      const blob =
        resp.data instanceof Blob
          ? resp.data
          : new Blob([JSON.stringify(resp.data, null, 2)], {
              type: 'application/json;charset=utf-8',
            });
      const date = new Date().toISOString().slice(0, 10);
      triggerBlobDownload(blob, `lexdraft-data-export-${date}.json`);
    },
  });
}

// -- deletion -----------------------------------------------------------------

export function useDeletionStatus() {
  // Read-only view onto whatever the request/cancel mutations stashed.
  // staleTime: Infinity so RQ never tries to refetch a non-existent endpoint.
  return useQuery<DeletionRequestResponse | null>({
    queryKey: DELETION_STATUS_KEY,
    queryFn: () => null,
    enabled: false,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useRequestDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeletionRequestInput) =>
      api.post<DeletionRequestResponse>('/me/dpdp/deletion-request', input),
    onSuccess: (data) => {
      qc.setQueryData(DELETION_STATUS_KEY, data);
    },
  });
}

export function useCancelDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/me/dpdp/deletion-cancel'),
    onSuccess: () => {
      qc.setQueryData(DELETION_STATUS_KEY, null);
    },
  });
}

// -- consent ------------------------------------------------------------------

export function useRecordConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordConsentInput) =>
      api.post<ConsentRecord>('/me/dpdp/consent', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dpdp', 'consents'] }),
  });
}

export function useConsentHistory() {
  return useQuery({
    queryKey: ['dpdp', 'consents'],
    queryFn: () => api.get<{ items: ConsentRecord[] }>('/me/dpdp/consents'),
    select: (r) => r.items,
  });
}
