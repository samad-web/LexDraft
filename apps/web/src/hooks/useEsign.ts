/**
 * Electronic signature - TanStack Query wrappers.
 *
 * Backend: apps/api/src/routes/esign.routes.ts. Self-built Section 3A
 * "electronic signature" (see 0079_esign.sql's header) - mirrors
 * useCoCounsel.ts's shape (list + mutations, invalidate-on-write) with the
 * public by-token/* endpoints a signer uses without a DifAI account.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type EsignRequestStatus =
  | 'draft' | 'sent' | 'partially_signed' | 'completed' | 'declined' | 'cancelled' | 'expired';
export type EsignSignerStatus =
  | 'pending' | 'viewed' | 'otp_sent' | 'otp_verified' | 'signed' | 'declined';

export interface EsignSigner {
  id: string;
  requestId: string;
  userId: string | null;
  name: string;
  email: string;
  order: number;
  status: EsignSignerStatus;
  consentAt: string | null;
  signedAt: string | null;
  createdAt: string;
}

export interface EsignRequest {
  id: string;
  firmId: string;
  caseId: string | null;
  requestedBy: string;
  title: string;
  sourceDocumentId: string;
  sourceSha256: string;
  signedDocumentId: string | null;
  signedSha256: string | null;
  status: EsignRequestStatus;
  documentTypeHint: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  createdAt: string;
  signers: EsignSigner[];
}

export interface EsignAuditEvent {
  id: string;
  requestId: string;
  signerId: string | null;
  eventType: string;
  detail: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  prevEventHash: string | null;
  eventHash: string;
  occurredAt: string;
}

export interface CreateEsignInput {
  title: string;
  sourceDocumentId: string;
  caseId?: string;
  documentTypeHint?: string;
  expiresInDays?: number;
  signers: Array<{ name: string; email: string; userId?: string; order?: number }>;
}

const KEY = ['esign'] as const;

export function useEsignRequests(caseId?: string) {
  return useQuery({
    queryKey: [...KEY, 'requests', caseId ?? null],
    queryFn: () => api.get<{ items: EsignRequest[] }>('/esign/requests', caseId ? { caseId } : undefined),
    select: (r) => r.items,
  });
}

export function useEsignRequest(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'requests', 'one', id],
    queryFn: () => api.get<EsignRequest>(`/esign/requests/${id}`),
    enabled: !!id,
  });
}

export function useEsignAuditTrail(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'requests', id, 'audit-trail'],
    queryFn: () => api.get<{ items: EsignAuditEvent[] }>(`/esign/requests/${id}/audit-trail`),
    select: (r) => r.items,
    enabled: !!id,
  });
}

export function useCreateEsignRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEsignInput) => api.post<EsignRequest>('/esign/requests', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'requests'] }),
  });
}

export function useSendEsignRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<EsignRequest>(`/esign/requests/${id}/send`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'requests'] }),
  });
}

export function useCancelEsignRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/esign/requests/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'requests'] }),
  });
}

// ---- Public (signer-facing, token-scoped) ----------------------------------

export interface EsignByTokenResponse {
  request: EsignRequest;
  signer: EsignSigner;
}

export function useEsignByToken(token: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'by-token', token],
    queryFn: () => api.get<EsignByTokenResponse>(`/esign/by-token/${token}`),
    enabled: !!token,
    retry: false,
  });
}

export function useEsignConsent(token: string | undefined) {
  return useMutation({
    mutationFn: () => api.post(`/esign/by-token/${token}/consent`),
  });
}

export function useEsignRequestOtp(token: string | undefined) {
  return useMutation({
    mutationFn: () => api.post<{ sent: boolean }>(`/esign/by-token/${token}/otp`),
  });
}

export function useEsignVerifyOtp(token: string | undefined) {
  return useMutation({
    mutationFn: (code: string) => api.post<{ verified: boolean }>(`/esign/by-token/${token}/otp/verify`, { code }),
  });
}

export function useEsignSign(token: string | undefined) {
  return useMutation({
    mutationFn: () => api.post<EsignRequest>(`/esign/by-token/${token}/sign`),
  });
}

export function useEsignDecline(token: string | undefined) {
  return useMutation({
    mutationFn: (reason?: string) => api.post(`/esign/by-token/${token}/decline`, { reason }),
  });
}
