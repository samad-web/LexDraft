/**
 * DPDP Act 2023 compliance DTOs — kept LOCAL to the api package on purpose.
 * Mirrors the shape returned by the data-principal endpoints under
 * `/api/me/dpdp/*`. The orchestrator will lift these into `@lexdraft/types`
 * once the consent-banner / settings UI wires up; treat this as the API's
 * provisional contract.
 */

export interface DpdpActor {
  id: string;
  email: string;
}

/** Trim of metadata that's safe to ship inside the export payload — strips
 *  password hashes, internal flags, etc. before serialisation. */
export interface ExportedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string | null;
  firmId: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

/** Top-level structure returned by GET /me/dpdp/export. Each domain section
 *  is `unknown[]` because the underlying rows are heterogenous and we want
 *  to ship them as-is (post password-hash redaction) for completeness. */
export interface UserDataExport {
  exportedAt: string;
  user: ExportedUser;
  drafts: unknown[];
  documents: unknown[];
  clients: unknown[];
  cases: unknown[];
  clauses: unknown[];
  diary: unknown[];
  tasks: unknown[];
  invoices: unknown[];
  expenses: unknown[];
  leads: unknown[];
  limitations: unknown[];
  physicalDocuments: unknown[];
  audit_entries: unknown[];
  consents: ConsentRecord[];
}

export interface DeletionRequest {
  /** ISO timestamp the row will be hard-deleted at. */
  scheduledPurgeAt: string;
  /** Retention window honoured. Default 30, capped at 365. */
  retentionDays: number;
  /** Alias for scheduledPurgeAt — the latest moment the user can cancel. */
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
  userId: string;
  firmId: string | null;
  consentType: string;
  consentVersion: string;
  granted: boolean;
  ip?: string | null;
  userAgent?: string | null;
}
