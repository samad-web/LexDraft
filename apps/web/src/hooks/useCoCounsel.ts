/**
 * Co-Counsel cross-firm handover - TanStack Query wrappers.
 *
 * Backend: apps/api/src/routes/co-counsel.routes.ts. Mirrors useCoverage.ts's
 * shape (list + mutations, invalidate-on-write) with the addition of the
 * public token-lookup/accept pair used by the accept-invite landing page,
 * matching useInvitations.ts's by-token hooks.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthResponse } from '@lexdraft/types';
import { api } from '@/lib/api';

export type HandoverTargetKind = 'in_firm_user' | 'existing_external_user' | 'new_external_invite' | 'open_link';
export type HandoverStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export type HandoverUrgency = 'normal' | 'urgent';

export interface HandoverRequest {
  id: string;
  caseId: string;
  caseTitle: string;
  caseCnr: string;
  sourceFirmId: string;
  requestedBy: string;
  requestedByName: string | null;
  targetKind: HandoverTargetKind;
  targetUserId: string | null;
  targetName: string | null;
  targetEmail: string | null;
  targetPhone: string | null;
  invitationId: string | null;
  reason: string | null;
  urgency: HandoverUrgency;
  status: HandoverStatus;
  attributedSignup: boolean;
  createdAt: string;
  resolvedAt: string | null;
  /** Only present on the response to a just-created open-link request - the
   *  raw accept-link token, once, so the UI can build the copy link + QR. */
  shareToken?: string;
}

export type HandoverTarget =
  | { existingUserId: string }
  | { name: string; email: string; phone?: string }
  | { open: true };

export interface CreateHandoverInput {
  target: HandoverTarget;
  reason?: string;
  urgency?: HandoverUrgency;
}

export interface CaseGuestGrant {
  id: string;
  caseId: string;
  guestUserId: string;
  grantingFirmId: string;
  handoverRequestId: string | null;
  status: 'active' | 'revoked';
  createdAt: string;
  revokedAt: string | null;
}

export interface GuestCaseView {
  caseId: string;
  title: string;
  cnr: string;
  court: string;
  stage: string;
  status: string;
  nextHearing: string | null;
  grantedBy: string;
  grantedAt: string;
}

export interface GuestHearingView {
  id: string;
  date: string | null;
  time: string;
  court: string;
  purpose: string;
  status: 'today' | 'upcoming' | 'past';
}

export interface GuestDocumentView {
  id: string;
  name: string;
  type: string;
  updated: string;
  hasFile: boolean;
}

export interface GuestNoteView {
  id: string;
  authorName: string;
  title: string | null;
  body: string;
  createdAt: string;
}

export interface GuestCaseDetail {
  summary: GuestCaseView;
  hearings: GuestHearingView[];
  documents: GuestDocumentView[];
  notes: GuestNoteView[];
}

export interface AcceptHandoverResult {
  auth?: AuthResponse;
  grant: CaseGuestGrant;
  upsell: { eligible: boolean };
}

export interface CoCounselInvitePreview {
  caseTitle: string;
  caseCnr: string;
  invitedName: string | null;
  sourceFirmName: string;
  reason: string | null;
  expiresAt: string;
  /** True for an open-link invite (QR/shared link) - no email was collected
   *  up front, so the accept form must ask for one. */
  requiresEmail: boolean;
}

const KEY = ['co-counsel'] as const;

/** Pending/resolved handover requests raised by the caller's firm. */
export function useHandoverRequests() {
  return useQuery({
    queryKey: [...KEY, 'requests'],
    queryFn: () => api.get<{ items: HandoverRequest[] }>('/co-counsel/requests'),
    select: (r) => r.items,
  });
}

/** Post a handover request for a case - target is an existing teammate,
 *  an existing DifAI user elsewhere, or a brand-new external advocate. */
export function useRequestHandover(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateHandoverInput) =>
      api.post<HandoverRequest>(`/co-counsel/cases/${caseId}/requests`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'requests'] }),
  });
}

export function useCancelHandover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<HandoverRequest>(`/co-counsel/requests/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'requests'] }),
  });
}

/** Existing (possibly cross-firm) user accepting a handover addressed to them. */
export function useAcceptHandover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) =>
      api.post<AcceptHandoverResult>(`/co-counsel/requests/${requestId}/accept`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'requests'] }),
  });
}

/** Public - preview an invite before the recipient has an account. */
export function useCoCounselInviteByToken(token: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'by-token', token],
    queryFn: () => api.get<CoCounselInvitePreview>(`/co-counsel/accept/by-token/${token}`),
    enabled: !!token,
    retry: false,
  });
}

/** Public - accept the invite, creating the guest's own trial account.
 *  `email` is required for open-link invites (no recipient known at
 *  creation time) and ignored for email-first invites. */
export function useAcceptCoCounselByToken() {
  return useMutation({
    mutationFn: ({ token, body }: { token: string; body: { name: string; signupToken: string } }) =>
      api.post<AcceptHandoverResult>(`/co-counsel/accept/by-token/${token}`, body),
  });
}

/** Cases the current user has cross-firm guest access to (read-only). */
export function useGuestCases() {
  return useQuery({
    queryKey: [...KEY, 'guest-cases'],
    queryFn: () => api.get<{ items: GuestCaseView[] }>('/co-counsel/guest-cases'),
    select: (r) => r.items,
  });
}

/** Full read-only bundle (summary + hearings + notes + documents) for one
 *  guest case. 404s as a whole if the grant is missing/revoked. */
export function useGuestCaseDetail(caseId: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'guest-cases', caseId],
    queryFn: () => api.get<GuestCaseDetail>(`/co-counsel/guest-cases/${caseId}`),
    enabled: !!caseId,
  });
}
