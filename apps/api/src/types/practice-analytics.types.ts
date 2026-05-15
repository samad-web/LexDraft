/**
 * Local types for the Practice-tier analytics surfaces.
 *
 * Kept inside `apps/api/src/types/` rather than `packages/types` because
 * these shapes are still in flux (data-model gaps documented in the route
 * file mean fields may move from per-member to firm-wide once `cases` grows
 * an `assignee` column). Once the shapes settle and the web surface stops
 * being the only consumer, promote them to `@lexdraft/types`.
 */

export interface WorkloadMember {
  /** UUID of the firm member. */
  userId: string;
  name: string;
  /** Free-text role label from `users.role` (the legacy column). */
  role: string;
  /**
   * Count of `cases` rows with status = 'Active' that we attribute to this
   * member. Because `cases` has no `assignee` column yet, this is the
   * firm-wide active count distributed evenly across members - see the
   * "Data-model gaps" note in the agent report. Once an assignee column
   * lands, switch to a real per-member count.
   */
  openMatters: number;
  /** Hearings (firm-wide) scheduled in the current ISO week. */
  hearingsThisWeek: number;
  /** Hearings (firm-wide) scheduled in the following ISO week. */
  hearingsNextWeek: number;
  /**
   * Open tasks attributed to this member. Tasks have an `assignee` text
   * column - we match it loosely against `users.name` (case-insensitive
   * exact match) and fall back to 0 if no row matches.
   */
  openTasks: number;
  /** `true` when openMatters > median * 1.5 across all members. */
  isOverloaded: boolean;
}

export interface WorkloadResponse {
  members: WorkloadMember[];
  /**
   * Firm-wide aggregates included so the UI can show the "we're splitting
   * X matters across Y members" hint even when per-member assignment is
   * still a heuristic.
   */
  totals: {
    activeMatters: number;
    hearingsThisWeek: number;
    hearingsNextWeek: number;
    memberCount: number;
  };
}

export interface ProfitabilityMatter {
  caseId: string;
  title: string;
  client: string;
  /** Sum of invoices in (pending|overdue|paid) attributed to this matter. */
  invoicedInr: number;
  /** Sum of invoices in status = 'paid'. */
  paidInr: number;
  /** Sum of expenses attributed to the matter; 0 if no link available. */
  expensesInr: number;
  /** paidInr - expensesInr */
  netInr: number;
  /** Rounded percent; null when paidInr = 0 (no realised revenue yet). */
  marginPct: number | null;
  /** `true` when marginPct is non-null and below the 20 % threshold. */
  isUnprofitable: boolean;
  /** ISO date of the most recent invoice issued against this matter, if any. */
  lastInvoiceAt: string | null;
}

export interface ProfitabilityResponse {
  matters: ProfitabilityMatter[];
}
