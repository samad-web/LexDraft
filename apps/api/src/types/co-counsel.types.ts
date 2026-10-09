/**
 * Co-Counsel handover DTOs - kept LOCAL to the api package, same convention
 * as coverage.types.ts: lifted into `@lexdraft/types` once the surface
 * stabilises.
 *
 * Denormalisation note: list responses include `requestedByName`/
 * `caseTitle`/`caseCnr` joined at read time (not stored) so the handover
 * board UI doesn't have to fan out a second fetch per row.
 */
import type { AuthResponse } from '@lexdraft/types';

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
  /** Only populated on the CREATE response for an `open_link` request - the
   *  raw accept-link token, shown once so the UI can render a copy button +
   *  QR code. Never included in list/get responses (the token is a bearer
   *  credential; re-fetching the list must not leak it again). */
  shareToken?: string;
}

/** Target is either an existing LexDraft user (in-firm or cross-firm,
 *  resolved by id), a not-yet-onboarded external advocate identified by
 *  contact details (legacy email-first path, still supported), or `open`
 *  for a shareable link/QR with no recipient known until they accept. */
export type HandoverTarget =
  | { existingUserId: string }
  | { name: string; email: string; phone?: string }
  | { open: true };

export interface CreateHandoverRequestInput {
  target: HandoverTarget;
  reason?: string;
  urgency?: HandoverUrgency;
}

/** Public preview + accept payload for an open-link invite - the recipient
 *  is unknown until they fill this in themselves. */
export interface AcceptOpenLinkInput {
  name: string;
  email: string;
  password: string;
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

/** Minimal read-only case summary a cross-firm guest is allowed to see.
 *  Deliberately narrower than the full `Case` DTO - no client billing
 *  details, no eCourts identity columns. */
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

/** Read-only hearing row for a guest's case view. Mirrors the shape of
 *  `Hearing`/`CalendarHearing` but is queried independently of
 *  hearings.service.ts so a guest's access path never shares a query with
 *  the firm-wide listers (which assume `ctx.firmId` owns everything they
 *  return). */
export interface GuestHearingView {
  id: string;
  date: string | null;
  time: string;
  court: string;
  purpose: string;
  status: 'today' | 'upcoming' | 'past';
}

/** Read-only document metadata for a guest's case view. No file bytes are
 *  returned here in Phase 1 - download requires a separate, explicitly
 *  guest-aware signed-URL path (not yet built; see Phase 2). */
export interface GuestDocumentView {
  id: string;
  name: string;
  type: string;
  updated: string;
  hasFile: boolean;
}

/** Read-only case note for a guest. Only `visibility='shared'` notes are
 *  ever included - a guest must never see another firm member's private
 *  working notes, same rule caseNotesService.list applies to firm members. */
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

export interface AcceptHandoverByTokenInput {
  name: string;
  password: string;
  /** Required when the invitation has no email on file (open-link invites -
   *  see migration 0074). Ignored for email-first invites, which already
   *  know the recipient's address from creation time. */
  email?: string;
}

export interface AcceptHandoverResult {
  auth?: AuthResponse;
  grant: CaseGuestGrant;
  upsell: { eligible: boolean };
}
