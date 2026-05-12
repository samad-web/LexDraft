// Shared domain types — the contract between apps/web and apps/api.
// Mirrors the data shapes the design uses (see _design/lexdraft/project/data.jsx).

export type ID = string;

export type CaseType =
  | 'Civil'
  | 'Criminal'
  | 'Commercial'
  | 'Property'
  | 'Banking'
  | 'Family'
  | 'Tax'
  | 'Other';

export type CaseStage =
  | 'Filing'
  | 'Summons'
  | 'WS'
  | 'Evidence'
  | 'Arguments'
  | 'Judgment'
  | 'Appeal'
  | 'Other';

export type CaseStatus = 'Active' | 'Pending' | 'Closed' | 'Archived';

export interface Case {
  id: ID;
  cnr: string;
  title: string;
  court: string;
  stage: CaseStage | string;
  client: string;
  status: CaseStatus;
  /** Next hearing date in ISO format (YYYY-MM-DD). */
  next: string;
  type: CaseType | string;
  /** Firm-side toggle: surface this matter in the client portal. */
  visibleToClient?: boolean;
}

export interface Hearing {
  id?: ID;
  /** HH:mm 24h. */
  time: string;
  case: string;
  court: string;
  purpose: string;
  status: 'today' | 'upcoming' | 'past';
}

export type AlertTone = 'vermillion' | 'amber' | 'cobalt' | 'sage';

export interface Alert {
  id?: ID;
  type: AlertTone;
  text: string;
  detail: string;
}

export interface DocumentRecord {
  id?: ID;
  name: string;
  type: string;
  /** Human-readable timestamp like "2h ago". */
  updated: string;
  case: string;
  /** Distinguishes uploaded physical documents from in-app drafts so the
   *  viewer can pick the right preview path. Optional for backwards-compat. */
  kind?: 'document' | 'draft';
  /** True when an uploaded file is attached. Set by the list endpoint so the
   *  table can show a file icon without paying the cost of the base64 blob. */
  hasFile?: boolean;
  /** Original uploaded filename (e.g. "plaint.pdf"). */
  fileName?: string;
  /** MIME type of the uploaded file (e.g. "application/pdf"). */
  fileMime?: string;
  /** File size in bytes. */
  fileSize?: number;
  /** Base64 contents of the uploaded file. Returned by GET /documents/:id
   *  only on the legacy/in-memory path. New uploads go through presigned URLs
   *  and clients should use `downloadUrl` instead.
   *  @deprecated prefer the presigned-URL flow. */
  fileBase64?: string;
  /** Opaque object key in the configured storage driver (local|s3|r2). */
  storageKey?: string;
  /** Firm-side toggle: surface this document in the client portal. */
  sharedWithClient?: boolean;
  /** Firm-side toggle: client must acknowledge receipt before "Action needed"
   *  pill clears. Paired with `signedAt` on the portal side. */
  requiresAcknowledgement?: boolean;
  /** Set when a client has acknowledged the document. */
  signedAt?: string;
}

export interface DocumentUploadUrlRequest {
  fileName: string;
  fileMime: string;
  fileSize: number;
}

export interface DocumentUploadUrlResponse {
  /** URL the client PUTs the binary body to. */
  uploadUrl: string;
  /** Storage key the client must echo back to /finalize. */
  storageKey: string;
  /** ISO timestamp the URL stops being valid. */
  expiresAt: string;
  /** Mime the client must send in the PUT's Content-Type header. */
  requiredContentType: string;
}

export interface DocumentDownloadUrlResponse {
  downloadUrl: string;
  expiresAt: string;
}

export type TaskPriority = 'very_high' | 'high' | 'medium' | 'low';
export type TaskColumn = 'pending' | 'progress' | 'review' | 'done';

export interface Task {
  id: ID;
  title: string;
  case: string;
  /** ISO date YYYY-MM-DD. */
  due: string;
  priority: TaskPriority;
  /** Initials of the assignee (matches design). */
  assignee: string;
  comments: number;
  column: TaskColumn;
}

export interface TaskBoard {
  pending: Task[];
  progress: Task[];
  review: Task[];
  done: Task[];
}

export type UserRole = 'Solo Advocate' | 'Practice Lead' | 'Managing Partner' | string;

/** Plan a firm is on. Mirrors the admin-only `FirmPlanTier` so tenants can read it too. */
export type UserPlan = 'Solo' | 'Practice' | 'Firm';

export interface User {
  id: ID;
  name: string;
  email: string;
  role: UserRole;
  firm?: string;
  /** Plan tier of the user's firm. Absent for users not yet attached to a firm. */
  plan?: UserPlan;
  isSuperadmin?: boolean;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface SignInRequest {
  email: string;
  password: string;
}

export interface SignUpRequest {
  email: string;
  password: string;
  name: string;
  role: 'solo' | 'group' | 'firm';
  firm?: string;
  enrolment?: string;
}

export interface DashboardSummary {
  user: Pick<User, 'name' | 'role'>;
  hearings: Hearing[];
  alerts: Alert[];
  recentDocs: DocumentRecord[];
  stats: {
    activeMatters: number;
    clients: number;
    unread: number;
    revenueFY: string;
  };
}

export interface FirmMember {
  id: ID;
  name: string;
  role: string;
  /** Initials for the avatar. */
  initials: string;
  activeMatters: number;
  /** Hours billed in the current month. */
  billableHours: number;
  /** Win rate as a percentage 0–100 across closed matters this FY. */
  winRate: number;
  status: 'Active' | 'On leave' | 'Inactive';
}

export interface PracticeAreaSlice {
  name: string;
  matters: number;
  /** INR string with a ₹ prefix, e.g. "₹4.2L". */
  revenue: string;
  /** Share of total firm revenue 0–1. */
  share: number;
}

export interface TopClient {
  name: string;
  /** INR string with a ₹ prefix. */
  billed: string;
  matters: number;
  /** Last activity, human-readable. */
  lastActivity: string;
}

export interface CaseStageSlice {
  stage: string;
  count: number;
}

export interface MonthlyRevenuePoint {
  /** Short month label (e.g. "Jan"). */
  month: string;
  value: number;
}

export interface FirmDashboardSummary {
  firm: {
    name: string;
    seats: number;
    seatsUsed: number;
    /** Friendly date string, e.g. "FY 25–26 · Q4". */
    period: string;
  };
  stats: {
    totalMatters: number;
    activeMatters: number;
    revenueFY: string;
    revenueDeltaPct: number;
    billableHoursMonth: number;
    realizationPct: number;
    advocatesActive: number;
    clientsActive: number;
  };
  members: FirmMember[];
  practiceAreas: PracticeAreaSlice[];
  topClients: TopClient[];
  caseStages: CaseStageSlice[];
  monthlyRevenue: MonthlyRevenuePoint[];
  alerts: Alert[];
  hearingsToday: Hearing[];
}

export interface DraftRequest {
  docType: string;
  language: 'EN' | 'HI' | 'TA';
  tone: 'Professional' | 'Firm' | 'Urgent' | 'Conciliatory';
  fields: Record<string, string>;
  /** ISO yyyy-mm-dd. Date the document is dated/issued. Defaults to today on the server if omitted. */
  draftDate?: string;
}

export interface DraftResponse {
  docType: string;
  text: string;
  generatedAt: string;
}

export interface SavedDraft {
  id: ID;
  title: string;
  docType: string;
  language: 'EN' | 'HI' | 'TA';
  tone: 'Professional' | 'Firm' | 'Urgent' | 'Conciliatory' | string;
  fields: Record<string, string>;
  editedHtml: string;
  bodyText: string;
  draftDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveDraftRequest {
  title?: string;
  docType: string;
  language: 'EN' | 'HI' | 'TA';
  tone: 'Professional' | 'Firm' | 'Urgent' | 'Conciliatory';
  fields: Record<string, string>;
  editedHtml: string;
  bodyText: string;
  draftDate?: string;
}

export interface ResearchAnswer {
  query: string;
  answer: string;
  citations: Array<{
    title: string;
    court: string;
    citation: string;
    excerpt: string;
  }>;
}

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}

// ---- Invitations ----------------------------------------------------------

export type InviteRole =
  | 'Managing Partner'
  | 'Senior Associate'
  | 'Associate'
  | 'Junior Associate'
  | 'Of Counsel'
  | 'Paralegal';

export type InvitationStatus = 'pending' | 'accepted' | 'cancelled' | 'expired';

export interface Invitation {
  id: ID;
  email: string;
  role: InviteRole;
  firm: string;
  invitedBy: { id: ID; name: string };
  status: InvitationStatus;
  /** Opaque token used in the public acceptance link. */
  token: string;
  /** ISO timestamp. */
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string;
  /** Optional personal note from the inviter. */
  message?: string;
}

/** Public payload safe to expose by token (no internal firm/user IDs). */
export interface InvitationPublic {
  email: string;
  role: InviteRole;
  firm: string;
  invitedBy: string;
  expiresAt: string;
  message?: string;
}

export interface CreateInvitationRequest {
  email: string;
  role: InviteRole;
  message?: string;
}

export interface AcceptInvitationRequest {
  name: string;
  password: string;
}

// ---- Platform admin -------------------------------------------------------
// Everything below is consumed only by the /admin tree (and its API routes).
// Tenants never see these shapes.

export type FirmPlanTier = UserPlan;
export type BillingStatus = 'trial' | 'active' | 'past_due' | 'cancelled';
export type FirmStatus = 'active' | 'suspended';
export type UserStatus = 'active' | 'suspended' | 'deactivated';

export interface FirmPlan {
  tier: FirmPlanTier;
  status: BillingStatus;
  /** Monthly recurring revenue in INR (paise-free integer rupees). */
  mrrInr: number;
  /** ISO date YYYY-MM-DD, or null on trial. */
  renewsAt: string | null;
}

/** Modules that can be toggled on/off per firm. */
export type FeatureModule =
  | 'drafting'
  | 'cases'
  | 'contracts'
  | 'billing'
  | 'research'
  | 'limitation'
  | 'ecourts'
  | 'analytics'
  | 'firm_dashboard';

export interface FeatureFlag {
  module: FeatureModule;
  enabled: boolean;
  updatedAt: string;
}

export interface FirmBranding {
  /** Display name shown in the firm's app shell (overrides firms.name for UI). */
  displayName: string;
  /** Optional logo URL. */
  logoUrl: string | null;
  /** Hex accent color (e.g. #0A0A0A) — used sparingly per the monochrome system. */
  accentColor: string | null;
}

export interface FirmSummary {
  id: ID;
  name: string;
  plan: FirmPlan;
  status: FirmStatus;
  seats: number;
  seatsUsed: number;
  /** Total cases for this firm. */
  caseCount: number;
  createdAt: string;
}

export interface FirmDetail extends FirmSummary {
  branding: FirmBranding;
  flags: FeatureFlag[];
  /** Last 20 audit log rows scoped to this firm. */
  recentAudit: AuditLogEntry[];
  members: AdminUserSummary[];
}

export interface AdminUserSummary {
  id: ID;
  name: string;
  email: string;
  role: string;
  firmId: ID | null;
  firmName: string | null;
  status: UserStatus;
  isSuperadmin: boolean;
  createdAt: string;
  /** Last sign-in (ISO) or null if the user never signed in. */
  lastSeenAt: string | null;
}

export type AuditAction =
  | 'firm.create'
  | 'firm.update'
  | 'firm.suspend'
  | 'firm.reactivate'
  | 'firm.delete'
  | 'firm.plan.update'
  | 'firm.flags.update'
  | 'firm.branding.update'
  | 'user.update'
  | 'user.suspend'
  | 'user.reactivate'
  | 'user.delete'
  | 'user.password_reset'
  | 'user.impersonate.start'
  | 'user.impersonate.end'
  | 'template.create'
  | 'template.update'
  | 'template.delete'
  // Tenant-scoped CRUD audit actions.
  | 'case.create'      | 'case.update'      | 'case.delete'
  | 'client.create'    | 'client.update'    | 'client.delete'
  | 'invoice.create'   | 'invoice.update'   | 'invoice.delete'
  | 'lead.create'      | 'lead.update'      | 'lead.delete' | 'lead.stage.update'
  | 'hearing.create'   | 'hearing.update'   | 'hearing.delete'
  | 'document.create'  | 'document.update'  | 'document.delete'
  | 'limitation.create'| 'limitation.update'| 'limitation.delete'
  // Client portal — actor is the portal client (actor_user_id is null;
  // payload carries `actorKind: 'portal_client'` and the client id).
  | 'portal.session.created'
  | 'portal.session.signed_out'
  | 'portal.dashboard.viewed'
  | 'portal.matter.viewed'
  | 'portal.document.viewed'
  | 'portal.document.acknowledged'
  | 'portal.message.sent'
  | 'portal.message.read'
  | 'portal.profile.viewed'
  | 'portal.profile.updated'
  | 'portal.dsr.forget_me_requested'
  // Firm-side portal administration (actor is a firm user).
  | 'portal.client.enabled'
  | 'portal.client.disabled'
  | 'portal.client.link_resent'
  | 'portal.document.shared'
  | 'portal.document.unshared'
  | 'portal.document.ack_required'
  | 'portal.document.ack_cleared'
  | 'portal.matter.visibility.updated'
  | 'portal.message.firm_sent'
  | 'portal.message.firm_read';

export type AuditTargetType =
  | 'firm' | 'user' | 'template' | 'platform'
  | 'case' | 'client' | 'invoice' | 'lead' | 'hearing' | 'document' | 'limitation'
  | 'portal_session' | 'portal_message';

export interface AuditLogEntry {
  id: ID;
  actorUserId: ID;
  actorEmail: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: ID | null;
  /** Free-form structured payload (before/after, reason, etc.). */
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export type TemplateScope = 'platform' | 'firm';

export interface DocumentTemplate {
  id: ID;
  name: string;
  slug: string;
  scope: TemplateScope;
  /** Required when scope = 'firm', null for platform-wide templates. */
  firmId: ID | null;
  body: string;
  updatedAt: string;
}

/** Result of starting an impersonation session. The token is a JWT bearing
 *  the target user's identity AND an `actAs` claim referencing the admin. */
export interface ImpersonationGrant {
  token: string;
  user: User;
  /** ISO timestamp when this grant expires. */
  expiresAt: string;
  /** The admin who started the session — for the banner & end-session call. */
  originalAdminId: ID;
}

/** Aggregate KPIs for the /admin home dashboard. */
export interface PlatformStats {
  firms: { total: number; active: number; suspended: number };
  users: { total: number; active: number; superadmins: number };
  /** Sum of mrrInr across all active firms. */
  mrrInr: number;
  /** Active matters across the platform. */
  caseCount: number;
  /** Recent audit entries (last 10) for the home feed. */
  recentAudit: AuditLogEntry[];
}

export interface AdminCreateFirmRequest {
  name: string;
  seats: number;
  plan: FirmPlanTier;
  /** Bootstrap Firm Admin (spec §3.1). Email is required so the tenant has an
   *  active admin from the moment it exists. */
  adminEmail: string;
  /** Falls back to the email's local part when omitted. */
  adminName?: string;
  /** When omitted the API generates a one-time password and returns it on the
   *  response so the platform operator can hand it off out-of-band. */
  adminPassword?: string;
}

/** Response shape for `POST /admin/firms`: the created firm plus the bootstrap
 *  admin's identity. `tempPassword` is populated only when the API generated
 *  the password — never echoed back when the operator supplied one. */
export interface AdminCreateFirmResponse {
  firm: FirmSummary;
  admin: {
    id: ID;
    email: string;
    name: string;
    /** Plaintext one-time password — present iff the API generated it. */
    tempPassword?: string;
  };
}

export interface AdminUpdateFirmRequest {
  name?: string;
  seats?: number;
  status?: FirmStatus;
}

export interface AdminUpdatePlanRequest {
  tier?: FirmPlanTier;
  status?: BillingStatus;
  mrrInr?: number;
  renewsAt?: string | null;
}

export interface AdminUpdateFlagsRequest {
  flags: Array<{ module: FeatureModule; enabled: boolean }>;
}

export interface AdminUpdateBrandingRequest {
  displayName?: string;
  logoUrl?: string | null;
  accentColor?: string | null;
}

export interface AdminUpdateUserRequest {
  role?: string;
  status?: UserStatus;
  isSuperadmin?: boolean;
  firmId?: ID | null;
}

export interface AdminCreateTemplateRequest {
  name: string;
  slug: string;
  scope: TemplateScope;
  firmId?: ID | null;
  body: string;
}

export interface AdminUpdateTemplateRequest {
  name?: string;
  body?: string;
}

export interface AuditLogQuery {
  actorUserId?: ID;
  targetType?: AuditTargetType;
  targetId?: ID;
  action?: AuditAction;
  /** Pagination — newest first. */
  limit?: number;
  offset?: number;
}

// ---- RBAC: roles, practice groups, features (spec §4-§6) ------------------

export type FeatureDomain =
  | 'baseline'
  | 'drafting'
  | 'review'
  | 'esign'
  | 'matter'
  | 'client'
  | 'admin'
  | 'reports';

/** A feature key from the platform catalog (e.g. 'drafting.ai', 'admin.users'). */
export type FeatureKey = string;

export interface FeatureCatalogItem {
  key: FeatureKey;
  name: string;
  description: string;
  domain: FeatureDomain;
  /** True iff every active user has this regardless of role/plan (spec §5.1). */
  defaultBaseline: boolean;
}

/** A system or firm-scoped role.
 *  - System roles: firmId === null and isSystem === true (the 8 from spec §4.1).
 *  - Custom roles: firmId !== null, scoped to one tenant. */
export interface Role {
  id: ID;
  firmId: ID | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  baseRoleId: ID | null;
  /** Number of users currently assigned this role. */
  userCount: number;
}

export interface PracticeGroup {
  id: ID;
  firmId: ID;
  name: string;
  leadUserId: ID | null;
  archivedAt: string | null;
  memberCount: number;
}

export interface CreatePracticeGroupRequest {
  name: string;
  leadUserId?: ID | null;
}

export interface UpdatePracticeGroupRequest {
  name?: string;
  leadUserId?: ID | null;
  archived?: boolean;
}

/** Resolved feature set for the current session — returned by GET /me/features. */
export interface MeFeaturesResponse {
  /** All features the user CAN exercise, after the 3-layer resolver runs. */
  features: FeatureKey[];
  /** Convenience: the user's role at the moment the resolver ran. */
  role: Pick<Role, 'id' | 'name' | 'isSystem'> | null;
  /** Convenience: the firm's plan tier. */
  plan: UserPlan | null;
}

/** A firm-admin-scoped user shape used by the /firm/users endpoint. Distinct
 *  from `AdminUserSummary`: tenant-scoped (no platform-wide stats), role
 *  surfaced as the structured object instead of a freeform string. */
export interface FirmManagedUser {
  id: ID;
  name: string;
  email: string;
  status: UserStatus;
  isSuperadmin: boolean;
  /** Resolved role (system or custom). null only during legacy migration. */
  role: Pick<Role, 'id' | 'name' | 'isSystem'> | null;
  /** Practice group attachment, if any. */
  practiceGroup: Pick<PracticeGroup, 'id' | 'name'> | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface FirmUpdateUserRequest {
  roleId?: ID;
  practiceGroupId?: ID | null;
  status?: UserStatus;
}

/** Direct user-creation request from a Firm Admin — bypasses the email/link
 *  flow when the admin already knows the credentials. Mirrors `AdminCreateFirmRequest`'s
 *  bootstrap-admin shape so the same Name@123 fallback applies. */
export interface FirmCreateUserRequest {
  email: string;
  /** Falls back to a name derived from the email's local part when omitted. */
  name?: string;
  /** Role ID; must reference a system role or a custom role belonging to the
   *  same firm. The server enforces this. */
  roleId: ID;
  /** Optional initial practice-group attachment. */
  practiceGroupId?: ID | null;
  /** Optional. When omitted the API generates `${FirstName}@123` and returns
   *  it on the response so the admin can hand it off out-of-band. */
  password?: string;
}

export interface FirmCreateUserResponse {
  user: FirmManagedUser;
  /** Plaintext password — present only when the API generated it. */
  tempPassword?: string;
}

// ---- Clause bank ----------------------------------------------------------

export interface Clause {
  id: ID;
  /** Free-text category, e.g. "Indemnity" or "Force Majeure". */
  category: string;
  title: string;
  description: string;
  /** Full clause text — the thing that gets pasted into a draft. */
  body: string;
  /** Times the clause has been copied/used. Server-tracked. */
  uses: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateClauseRequest {
  category: string;
  title: string;
  description: string;
  body: string;
}

export interface UpdateClauseRequest {
  category?: string;
  title?: string;
  description?: string;
  body?: string;
}

export interface ImportClausesRequest {
  /** Each item must include the same fields as a single create. */
  items: CreateClauseRequest[];
}

export interface ImportClausesResult {
  inserted: number;
  skipped: number;
}

// ---- Clients --------------------------------------------------------------

export type ClientType = 'Individual' | 'Corporate' | 'Govt';
export type ClientStatus = 'active' | 'inactive' | 'prospect';

export interface Client {
  id: ID;
  name: string;
  type: ClientType;
  status: ClientStatus;
  /** ISO date YYYY-MM-DD or empty. */
  lastContact: string;
  /** Number of currently-open matters for this client (computed). */
  mattersOpen: number;
  /** Optional contact email. Required to grant the client portal access. */
  email?: string;
  /** Firm-side toggle: when true, this client may sign in to the portal. */
  portalEnabled?: boolean;
}

// ---- Client portal --------------------------------------------------------

export interface PortalRequestLinkResponse {
  /** Always present so the endpoint can't be used to enumerate registered
   *  client emails — both registered and unregistered emails get the same
   *  generic acknowledgement. */
  ok: true;
  /** Plaintext magic link, ONLY returned in dev (when LLM_PROVIDER === 'none'
   *  is a sufficient signal that this is a demo run, OR explicitly when
   *  CLIENT_PORTAL_RETURN_LINK=true). Never set in production. */
  devMagicLink?: string;
}

export interface PortalSession {
  token: string;
  expiresAt: string;
  client: {
    id: ID;
    name: string;
    email: string;
    firmId: ID;
  };
}

export interface PortalCaseSummary {
  id: ID;
  cnr: string;
  title: string;
  court: string;
  stage: string;
  status: CaseStatus;
  /** Next hearing date in ISO format (YYYY-MM-DD) or empty. */
  next: string;
  type: string;
}

export interface PortalHearingSummary {
  id?: ID;
  /** Date of the hearing (YYYY-MM-DD). */
  date?: string;
  /** HH:mm 24h. */
  time: string;
  case: string;
  court: string;
  purpose: string;
}

export interface PortalInvoiceSummary {
  id: ID;
  invoiceNo: string;
  amountInr: number;
  issuedDate: string;
  dueDate: string;
  status: 'paid' | 'pending' | 'overdue';
}

export interface PortalDocumentSummary {
  id: ID;
  name: string;
  type: string;
  case: string;
  updated: string;
  hasFile: boolean;
  /** Firm-side has flagged this document as requiring client acknowledgement. */
  requiresAck: boolean;
  /** ISO timestamp when the client acknowledged it; absent when not yet signed. */
  signedAt?: string;
}

// ---- Portal dashboard / matter detail / messages --------------------------

/** Aggregated payload served by `GET /api/portal/dashboard` so first paint
 *  is one round trip rather than five (CLIENT_PORTAL.md §4.2). */
export interface PortalDashboard {
  client: { id: ID; name: string; email: string; firmId: ID };
  counts: {
    activeMatters: number;
    upcomingHearings: number;
    documentsToSign: number;
    openInvoices: number;
    unreadMessages: number;
  };
  /** Top 5 active matters, most-recently-active first. */
  matters: PortalCaseSummary[];
  /** Next 5 upcoming hearings across all matters. */
  hearings: PortalHearingSummary[];
  /** Last 5 shared documents. */
  documents: PortalDocumentSummary[];
  /** Top unpaid invoices first, then most recent paid. */
  invoices: PortalInvoiceSummary[];
}

/** Full payload for `GET /api/portal/matters/:id`. The matter itself plus its
 *  hearings, documents, and the message thread on this matter. */
export interface PortalMatterDetail {
  matter: PortalCaseSummary;
  hearings: PortalHearingSummary[];
  documents: PortalDocumentSummary[];
  messages: PortalMessage[];
}

export interface PortalMessage {
  id: ID;
  /** null on the per-client "general" thread. */
  matterId: ID | null;
  /** Display label for the matter ("general" when matterId is null). */
  matterLabel?: string;
  senderKind: 'client' | 'firm';
  senderName: string;
  body: string;
  /** ISO timestamp. */
  sentAt: string;
  /** ISO timestamp; absent until the recipient has read it. */
  readAt?: string;
  /** True iff the current viewer is the message's sender. UI-only convenience. */
  mine: boolean;
}

export interface PortalSendMessageRequest {
  /** null or omitted → the per-client "general" thread. */
  matterId?: ID | null;
  body: string;
}

export interface PortalAcknowledgeDocumentResponse {
  id: ID;
  /** ISO timestamp the acknowledgement was recorded. */
  signedAt: string;
}

// ---- Portal profile -------------------------------------------------------

/** Notification preferences exposed on `/portal/profile` (CLIENT_PORTAL.md
 *  §4.8). Each key maps to a category of email the firm-side may emit. */
export interface PortalNotificationPreferences {
  newDocument: boolean;
  hearingReminder: boolean;
  newMessage: boolean;
  invoiceIssued: boolean;
  invoiceOverdue: boolean;
}

/** v1 ships English-only; the field exists so v2 can flip it to Hindi /
 *  regional languages without a schema change. */
export type PortalLanguage = 'en';

export interface PortalProfile {
  client: { id: ID; name: string; email: string; firmId: ID };
  language: PortalLanguage;
  notifications: PortalNotificationPreferences;
}

/** Partial update — only the keys the client wants to change. */
export interface PortalProfileUpdate {
  language?: PortalLanguage;
  notifications?: Partial<PortalNotificationPreferences>;
}

export interface PortalForgetMeRequest {
  /** Optional free-text reason; passed into the audit entry. */
  reason?: string;
}

// ---- Firm-side portal admin -----------------------------------------------

export interface FirmEnablePortalResponse {
  ok: true;
  clientId: ID;
  /** Plaintext magic link, only returned in dev (CLIENT_PORTAL_RETURN_LINK=true). */
  devMagicLink?: string;
}

/** A row in the firm-side "Portal messages" inbox — one entry per
 *  (client × matter|null) thread, with unread count and last-message preview. */
export interface FirmPortalThreadSummary {
  clientId: ID;
  clientName: string;
  matterId: ID | null;
  matterTitle: string | null;
  /** ISO timestamp of the most recent message in the thread. */
  lastMessageAt: string;
  /** Preview body of the most recent message, truncated to ~120 chars. */
  lastMessagePreview: string;
  /** Number of client → firm messages on this thread that are not yet read. */
  unreadFromClient: number;
}

// ---- Limitations calculator -----------------------------------------------

export type LimitationPeriodUnit = 'days' | 'months' | 'years';

export interface LimitationPeriod {
  unit: LimitationPeriodUnit;
  count: number;
}

export interface LimitationFilingType {
  id: string;
  category: string;
  label: string;
  period: LimitationPeriod;
  reference: string;
  triggerLabel: string;
  notes?: string[];
}

export interface LimitationCalculationStep {
  label: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  daysFromTrigger: number;
  notes?: string;
}

export interface LimitationCalculation {
  filingType: LimitationFilingType;
  triggerDate: string;
  deadline: string;
  daysRemaining: number;
  steps: LimitationCalculationStep[];
  warnings: string[];
}

export interface LimitationCalculateRequest {
  filingTypeId: string;
  /** ISO YYYY-MM-DD. */
  triggerDate: string;
}

// ---- Leads ----------------------------------------------------------------

export type LeadStage = 'new' | 'qualified' | 'proposal' | 'won' | 'lost';

export interface Lead {
  id: ID;
  name: string;
  /** Estimated engagement value in INR (whole rupees). */
  valueInr: number;
  referrer: string;
  stage: LeadStage;
  /** ISO timestamp the lead was captured. */
  capturedAt: string;
}

// ---- Invoices -------------------------------------------------------------

export type InvoiceStatus = 'paid' | 'pending' | 'overdue';

export interface Invoice {
  id: ID;
  invoiceNo: string;
  client: string;
  amountInr: number;
  /** ISO date YYYY-MM-DD. */
  issuedDate: string;
  /** ISO date YYYY-MM-DD. */
  dueDate: string;
  status: InvoiceStatus;
}

// ---- Expenses -------------------------------------------------------------

export type ExpenseStatus = 'pending' | 'approved' | 'billed';

export interface Expense {
  id: ID;
  expenseNo: string;
  /** ISO date YYYY-MM-DD. */
  date: string;
  description: string;
  category: string;
  caseLabel: string;
  amountInr: number;
  status: ExpenseStatus;
  reimbursable: boolean;
  billable: boolean;
}

// ---- Limitations ----------------------------------------------------------

export interface Limitation {
  id: ID;
  caseLabel: string;
  cnr: string;
  filingType: string;
  forum: string;
  /** ISO date YYYY-MM-DD. */
  deadline: string;
  filedBy: string;
  /** Days remaining vs today (server-computed). */
  daysRemaining: number;
}

// ---- Diary entries --------------------------------------------------------

export type DiaryKind = 'hearing' | 'judgment' | 'filing';

export interface DiaryEntry {
  id: ID;
  /** ISO date YYYY-MM-DD. */
  date: string;
  /** HH:mm or empty. */
  time: string;
  kind: DiaryKind;
  caseLabel: string;
  cnr: string;
  detail: string;
  forum: string;
}

// ---- Physical documents register -----------------------------------------

export type PhysicalDocStatus =
  | 'in_chambers'
  | 'court_file'
  | 'client'
  | 'co_counsel'
  | 'archive_box'
  | 'lost'
  | 'returned';

export interface PhysicalDocument {
  id: ID;
  /** Optional link to a matter; free-floating documents have a null caseId. */
  caseId: ID | null;
  /** Display label for the matter — denormalised so list views never join. */
  caseLabel?: string;
  /** Physical file/folder/cabinet identifier (barcode or hand-written ref). */
  fileNo: string;
  title: string;
  /** Free-text classifier ("Original deed", "Affidavit"…). */
  docType?: string;
  location: string;
  custodian?: string;
  status: PhysicalDocStatus;
  notes?: string;
  /** YYYY-MM-DD when the document came into the firm's possession. */
  receivedAt?: string;
  /** ISO timestamp when the row was archived (soft delete). */
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePhysicalDocumentRequest {
  caseId?: ID | null;
  caseLabel?: string;
  fileNo: string;
  title: string;
  docType?: string;
  location: string;
  custodian?: string;
  status?: PhysicalDocStatus;
  notes?: string;
  receivedAt?: string;
}

export type UpdatePhysicalDocumentRequest = Partial<CreatePhysicalDocumentRequest>;

// ---- Archive (closed cases with outcome) ---------------------------------

export type CaseOutcome = 'Won' | 'Lost' | 'Settled' | 'Withdrawn';

export interface ArchivedMatter {
  id: ID;
  cnr: string;
  title: string;
  client: string;
  court: string;
  outcome: CaseOutcome;
  /** ISO date YYYY-MM-DD or empty. */
  closedDate: string;
}

// ---- Calendar / cause list / analytics ------------------------------------

export interface CalendarHearing extends Hearing {
  /** ISO date YYYY-MM-DD this hearing falls on. */
  date: string;
}

export interface CalendarWeek {
  /** ISO date of Monday for this week. */
  weekStart: string;
  days: Array<{
    /** ISO date YYYY-MM-DD. */
    date: string;
    weekday: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
    count: number;
    isToday: boolean;
  }>;
  /** All hearings across the week. */
  hearings: CalendarHearing[];
}

export interface AnalyticsSummary {
  kpis: {
    activeMatters: number;
    /** Hours billed this calendar month. */
    billableHoursMonth: number;
    /** YTD revenue in INR (whole rupees). */
    revenueYtdInr: number;
    /** Win rate 0–100 over closed-with-outcome cases. */
    winRatePct: number;
  };
  /** Stage distribution for currently-active cases. */
  stages: Array<{ label: string; count: number }>;
  /** Trailing 12 months of revenue, oldest first, in lakhs. */
  monthlyRevenue: Array<{ label: string; value: number }>;
}
