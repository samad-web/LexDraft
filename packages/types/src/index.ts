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

export interface User {
  id: ID;
  name: string;
  email: string;
  role: UserRole;
  firm?: string;
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

export type FirmPlanTier = 'Solo' | 'Practice' | 'Firm';
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
  | 'template.delete';

export interface AuditLogEntry {
  id: ID;
  actorUserId: ID;
  actorEmail: string;
  action: AuditAction;
  targetType: 'firm' | 'user' | 'template' | 'platform';
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
  targetType?: 'firm' | 'user' | 'template' | 'platform';
  targetId?: ID;
  action?: AuditAction;
  /** Pagination — newest first. */
  limit?: number;
  offset?: number;
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
