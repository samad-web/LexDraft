/**
 * Hearing-coverage swap board DTOs — kept LOCAL to the api package on
 * purpose. The web client imports these via the route response shape; once
 * the surface stabilises the orchestrator will lift the public-facing types
 * (CoverageRequest, CoverageStatus) into `@lexdraft/types`.
 *
 * Denormalisation note: list/get responses include `requestedByName` and
 * `claimedByName` so the board UI doesn't have to fan-out a second fetch per
 * card. The names are joined from `users` at read time — we don't store them
 * on the row.
 */

export type CoverageStatus = 'open' | 'claimed' | 'cancelled' | 'completed';

export interface CoverageRequest {
  id: string;
  firmId: string;
  hearingId: string | null;
  caseId: string | null;
  caseLabel: string;
  court: string;
  hearingDate: string;   // YYYY-MM-DD
  hearingTime: string;
  purpose: string;
  briefUrl: string | null;
  briefNotes: string | null;
  status: CoverageStatus;
  requestedBy: string;
  requestedByName: string | null;
  claimedBy: string | null;
  claimedByName: string | null;
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
}

export interface CreateCoverageRequestInput {
  hearingId?: string;
  caseId?: string;
  caseLabel?: string;
  court?: string;
  hearingDate?: string;
  hearingTime?: string;
  purpose?: string;
  briefUrl?: string;
  briefNotes?: string;
}

export interface ListCoverageFilter {
  firmId: string | null;
  status?: CoverageStatus;
}
