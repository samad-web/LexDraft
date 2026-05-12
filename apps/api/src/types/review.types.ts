/**
 * Contract-review DTOs — kept LOCAL to the api package on purpose. The
 * orchestrator will promote/unify these into `@lexdraft/types` once the
 * feature ships to the web client and stabilises; until then, treat this
 * file as the API's provisional contract.
 *
 * One "review" is a single LLM run over a contract paste. Findings are
 * clause-level: severity-tagged observations with a verbatim excerpt, the
 * Indian-law citation the model invoked, and a remediation suggestion.
 */

export type ReviewPerspective =
  | 'Client'
  | 'Vendor'
  | 'Employer'
  | 'Employee'
  | 'Landlord'
  | 'Tenant'
  | 'Company';

export type ReviewSeverity =
  | 'Critical'
  | 'High'
  | 'Moderate'
  | 'Missing'
  | 'Negotiable'
  | 'Standard';

export type ReviewStatus = 'pending' | 'analyzing' | 'completed' | 'failed';

/** Human-decision lifecycle. Distinct from `ReviewStatus`, which tracks the
 *  AI run. A review can be `status='completed'` AND `decision=null` — the AI
 *  finished, no human has decided yet. */
export type ReviewDecision = 'pending' | 'changes_requested' | 'approved';

export interface ReviewAssignee {
  id: string;
  name: string;
  email: string;
}

export interface ContractReviewFinding {
  severity: ReviewSeverity;
  /** Short headline shown in the findings card. */
  title: string;
  /** Verbatim excerpt from the contract — the clause the model flagged.
   *  Empty for findings of kind 'Missing' (since the clause isn't there). */
  excerpt: string;
  /** Statute, section, or precedent the model cited (e.g. "Sec 23 ICA, 1872"). */
  law: string;
  /** Plain-language remediation: redline or counter-clause. */
  suggestion: string;
}

export interface ContractReviewSummary {
  id: string;
  firmId: string;
  caseId: string | null;
  documentId: string | null;
  perspective: ReviewPerspective;
  title: string;
  sourceFilename: string | null;
  status: ReviewStatus;
  riskScore: number | null;
  /** One-line executive summary — populated when status='completed'. */
  summary: string | null;
  provider: string | null;
  errorMessage: string | null;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
  // ---- Human workflow layer (migration 0027) -----------------------------
  assignedTo: ReviewAssignee | null;
  decision: ReviewDecision | null;
  decidedAt: string | null;
  decidedBy: ReviewAssignee | null;
  /** Convenience count — saves the UI an extra request when listing. */
  commentCount: number;
}

/** Full review payload — what GET /api/review/:id returns. Adds the
 *  source text and findings to the summary. */
export interface ContractReview extends ContractReviewSummary {
  /** The contract text the LLM saw. Surfaced so the UI can render the
   *  source side-by-side with the findings. */
  sourceText: string;
  findings: ContractReviewFinding[];
}

export interface CreateContractReviewRequest {
  perspective: ReviewPerspective;
  /** Pasted contract text. Required. Use sourceFilename to label uploads
   *  whose body was extracted client-side. */
  sourceText: string;
  /** Optional friendly title. Falls back to sourceFilename → first line of
   *  source_text → "Untitled review". */
  title?: string;
  sourceFilename?: string;
  /** Optional matter attachment. Caller's firm scope is enforced. */
  caseId?: string;
  documentId?: string;
  /** Per-request LLM override. Same shape as the drafting service. */
  provider?: 'xai' | 'anthropic';
}

export interface ListContractReviewsResponse {
  items: ContractReviewSummary[];
}

/** What the LLM is asked to emit. We coerce/clamp at the service layer
 *  before persisting, so the DB never holds malformed findings. */
export interface RawReviewLlmOutput {
  riskScore: number;
  summary: string;
  findings: ContractReviewFinding[];
}

// ---- Lifecycle + comments ---------------------------------------------------

export interface UpdateReviewLifecycleRequest {
  /** Pass `null` to unassign. Omit the field to leave the assignee untouched. */
  assignedTo?: string | null;
  /** Pass a new decision; `null` re-opens the review to pending. */
  decision?: ReviewDecision | null;
}

export interface ReviewCommentAuthor {
  id: string;
  name: string;
  email: string;
}

export interface ReviewComment {
  id: string;
  reviewId: string;
  /** Null for review-level comments; otherwise position in findings[]. */
  findingIndex: number | null;
  parentCommentId: string | null;
  author: ReviewCommentAuthor | null;
  /** Empty when the comment has been soft-deleted. */
  body: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReviewCommentRequest {
  body: string;
  findingIndex?: number;
  parentCommentId?: string;
}

export interface UpdateReviewCommentRequest {
  body: string;
}

export interface ListReviewCommentsResponse {
  items: ReviewComment[];
}
