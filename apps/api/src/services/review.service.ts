/**
 * Contract-review service.
 *
 * What changed: the legacy UI at /app/review was a static mock - hardcoded
 * findings, a 2.2-second setTimeout for "Analyzing", no persistence. This
 * service replaces that with a real LLM call that returns clause-level
 * findings + risk score, persisted per-firm so the user can revisit prior
 * reviews and (optionally) attach them to a case.
 *
 * Workflow layer (migration 0027): a review can be assigned to a firm
 * member, who reviews the AI findings and either approves or requests
 * changes. The decision (`decision` column) is what the requester acts on;
 * the AI's score is advisory. The assignee/decider join is materialised on
 * read so the UI never has to chase down user names.
 *
 * Tenant scope: every read/write is firm-scoped via firm_id. Optional
 * case_id / document_id attachments ON DELETE SET NULL so reviews survive
 * the underlying matter being archived.
 *
 * LLM contract: the model is prompted to emit a strict JSON shape (see
 * `RawReviewLlmOutput`). We parse-and-validate, coercing severities to
 * the enum and clamping the risk score to 0-100. Malformed model output
 * falls back to status='failed' rather than persisting garbage.
 *
 * Demo / no-key mode: when `env.llmProvider === 'none'` the service emits
 * a single deterministic finding with a "Demonstration" banner so the UI
 * doesn't go blank in dev - same pattern the research service uses.
 *
 * In-memory fallback (no DATABASE_URL): a per-firm Map mirrors the table
 * surface so the demo trail works without a Postgres.
 */

import { db } from '../db/client';
import { env } from '../env';
import { logger } from '../logger';
import { withRetry, HttpRetryError } from '../lib/retry';
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from '../lib/errors';
import { notify } from './notifications.service';
import { aiUsageService } from './ai-usage.service';
import { anthropicUsage, xaiUsage, type NormalizedUsage } from '../lib/llm-usage';
import type {
  ContractReview,
  ContractReviewFinding,
  ContractReviewSummary,
  CreateContractReviewRequest,
  ListContractReviewsResponse,
  RawReviewLlmOutput,
  ReviewAssignee,
  ReviewDecision,
  ReviewPerspective,
  ReviewSeverity,
  ReviewStatus,
  UpdateReviewLifecycleRequest,
} from '../types/review.types';

// Cap the raw paste size we send to the LLM. Larger contracts will be
// truncated with a clear marker in the prompt - better than refusing
// outright, and the LLM will note in the summary that the tail wasn't
// reviewed. ~120KB is roughly 30-40 pages of standard prose.
const MAX_SOURCE_CHARS = 120_000;

const VALID_SEVERITIES: ReadonlySet<ReviewSeverity> = new Set([
  'Critical', 'High', 'Moderate', 'Missing', 'Negotiable', 'Standard',
]);

interface ReviewRow {
  id: string;
  firm_id: string;
  case_id: string | null;
  document_id: string | null;
  perspective: string;
  title: string;
  source_filename: string | null;
  source_text: string;
  status: ReviewStatus;
  risk_score: number | null;
  findings_json: ContractReviewFinding[] | string | null;
  summary: string | null;
  provider: string | null;
  error_message: string | null;
  created_by: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  // ---- 0027 workflow columns ---------------------------------------------
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_to_email: string | null;
  decision: ReviewDecision | null;
  decided_at: Date | string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_by_email: string | null;
  comment_count: string | number | null;
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v;
}

function buildAssignee(
  id: string | null,
  name: string | null,
  email: string | null,
): ReviewAssignee | null {
  if (!id) return null;
  return { id, name: name ?? '', email: email ?? '' };
}

function rowToSummary(r: ReviewRow): ContractReviewSummary {
  return {
    id: r.id,
    firmId: r.firm_id,
    caseId: r.case_id,
    documentId: r.document_id,
    perspective: r.perspective as ReviewPerspective,
    title: r.title,
    sourceFilename: r.source_filename,
    status: r.status,
    riskScore: r.risk_score,
    summary: r.summary,
    provider: r.provider,
    errorMessage: r.error_message,
    createdBy: r.created_by,
    createdAt: toIso(r.created_at),
    completedAt: r.completed_at ? toIso(r.completed_at) : null,
    assignedTo: buildAssignee(r.assigned_to, r.assigned_to_name, r.assigned_to_email),
    decision: r.decision,
    decidedAt: r.decided_at ? toIso(r.decided_at) : null,
    decidedBy: buildAssignee(r.decided_by, r.decided_by_name, r.decided_by_email),
    commentCount:
      r.comment_count !== null && r.comment_count !== undefined ? Number(r.comment_count) : 0,
  };
}

function rowToReview(r: ReviewRow): ContractReview {
  const findings = parseFindings(r.findings_json);
  return {
    ...rowToSummary(r),
    sourceText: r.source_text,
    findings,
  };
}

function parseFindings(raw: ContractReviewFinding[] | string | null): ContractReviewFinding[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

function deriveTitle(req: CreateContractReviewRequest): string {
  if (req.title && req.title.trim()) return req.title.trim();
  if (req.sourceFilename && req.sourceFilename.trim()) return req.sourceFilename.trim();
  const first = req.sourceText.split('\n').find((l) => l.trim());
  if (first && first.length <= 80) return first.trim();
  if (first) return first.slice(0, 77).trim() + '…';
  return 'Untitled review';
}

// ---------- Prompt construction --------------------------------------------

interface BuiltPrompt {
  system: string;
  user: string;
}

function buildPrompt(perspective: ReviewPerspective, sourceText: string): BuiltPrompt {
  const truncated = sourceText.length > MAX_SOURCE_CHARS;
  const body = truncated
    ? sourceText.slice(0, MAX_SOURCE_CHARS) + '\n\n[…truncated for length - review continues from the start of the document only…]'
    : sourceText;

  const system = `You are an experienced Indian commercial-law advocate reviewing a contract on behalf of the ${perspective}. Identify clauses that materially disadvantage the ${perspective}, flag missing standard clauses, and surface negotiable points. Cite Indian statutes (Indian Contract Act 1872 / Specific Relief Act 1963 / DPDPA 2023 / etc.) and leading authorities by name where applicable.

Output STRICT JSON - no prose, no markdown, no code fences - matching this shape exactly:

{
  "riskScore": <integer 0-100, higher = worse for the ${perspective}>,
  "summary": "<one or two sentence executive summary>",
  "findings": [
    {
      "severity": "Critical" | "High" | "Moderate" | "Missing" | "Negotiable" | "Standard",
      "title": "<short headline, under 80 chars>",
      "excerpt": "<verbatim clause text from the contract - leave empty string for severity=Missing>",
      "law": "<statute/section or leading case>",
      "suggestion": "<remediation: redline or counter-clause, under 200 chars>"
    }
  ]
}

Severity rubric:
- Critical: clause is enforceable as drafted and exposes the ${perspective} to material loss, statutory non-compliance, or unilateral termination/forfeiture.
- High: significant risk that can be litigated but only with material cost.
- Moderate: imbalance the ${perspective} should renegotiate.
- Missing: a standard protective clause is absent (e.g. DPDPA, force majeure, indemnity cap).
- Negotiable: minor terms worth bargaining for.
- Standard: cite only if there's a noteworthy market-standard clause already present and adequate.

Return at most 12 findings. Order by severity (Critical first).`;

  const user = `Review the contract below. The ${perspective} is the party I represent. Respond with the JSON described above and nothing else.

# Contract
${body}`;

  return { system, user };
}

// ---------- LLM client calls ------------------------------------------------

type ProviderOverride = 'xai' | 'anthropic' | undefined;
type ResolvedProvider = 'xai' | 'anthropic' | 'none';

function resolveProvider(override: ProviderOverride): ResolvedProvider {
  if (override === 'xai' && env.XAI_API_KEY) return 'xai';
  if (override === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  return env.llmProvider;
}

interface LlmResult extends NormalizedUsage {
  text: string;
}

async function callClaude(prompt: BuiltPrompt): Promise<LlmResult> {
  return withRetry(
    async () => {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: env.ANTHROPIC_MODEL,
          max_tokens: 4096,
          system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: prompt.user }],
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new HttpRetryError(response.status, `Claude API ${response.status}: ${body}`);
      }
      const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
        usage?: Parameters<typeof anthropicUsage>[0];
      };
      const text = data.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
      return { text, ...anthropicUsage(data.usage) };
    },
    {
      onRetry: (err, attempt, waitMs) =>
        logger.warn({ err, attempt, waitMs }, 'review Claude call retry'),
    },
  );
}

async function callGrok(prompt: BuiltPrompt): Promise<LlmResult> {
  return withRetry(
    async () => {
      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.XAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.XAI_MODEL,
          max_tokens: 4096,
          // Grok supports JSON-mode via response_format. Anthropic relies on
          // the prompt's "STRICT JSON" directive - both providers go through
          // the same parser below regardless.
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new HttpRetryError(response.status, `xAI API ${response.status}: ${body}`);
      }
      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage?: Parameters<typeof xaiUsage>[0];
      };
      return {
        text: data.choices[0]?.message?.content ?? '',
        ...xaiUsage(data.usage),
      };
    },
    {
      onRetry: (err, attempt, waitMs) =>
        logger.warn({ err, attempt, waitMs }, 'review Grok call retry'),
    },
  );
}

// ---------- LLM output parsing ---------------------------------------------

/** Strip ```json fences if the model added them despite instructions. */
function stripFences(text: string): string {
  const t = text.trim();
  if (t.startsWith('```')) {
    const inner = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    return inner.trim();
  }
  return t;
}

function clampScore(n: unknown): number | null {
  const num = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function coerceSeverity(s: unknown): ReviewSeverity {
  if (typeof s === 'string' && VALID_SEVERITIES.has(s as ReviewSeverity)) {
    return s as ReviewSeverity;
  }
  // Default unknown severities to "Moderate" rather than dropping the finding
  // - better to surface it than to lose the model's signal.
  return 'Moderate';
}

function coerceFindings(raw: unknown): ContractReviewFinding[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .slice(0, 24) // hard cap; prompt asks for 12, leave headroom for variance.
    .map((f) => ({
      severity: coerceSeverity(f.severity),
      title: String(f.title ?? '').slice(0, 200),
      excerpt: String(f.excerpt ?? '').slice(0, 2000),
      law: String(f.law ?? '').slice(0, 200),
      suggestion: String(f.suggestion ?? '').slice(0, 500),
    }))
    .filter((f) => f.title.length > 0);
}

function parseLlmJson(raw: string): RawReviewLlmOutput {
  const stripped = stripFences(raw);
  // Some models leak a trailing "Note: …" or wrap the JSON in prose despite
  // the prompt. Take the largest balanced JSON object we can find.
  let candidate = stripped;
  if (!candidate.startsWith('{')) {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      candidate = candidate.slice(firstBrace, lastBrace + 1);
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    throw new Error(`LLM did not return parseable JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM JSON was not an object');
  }
  const obj = parsed as Record<string, unknown>;
  const score = clampScore(obj.riskScore);
  const findings = coerceFindings(obj.findings);
  if (findings.length === 0 && score === null) {
    throw new Error('LLM JSON had neither score nor findings');
  }
  return {
    riskScore: score ?? 50,
    summary: String(obj.summary ?? '').slice(0, 1000),
    findings,
  };
}

// ---------- Demo / no-key output -------------------------------------------

function demoOutput(perspective: ReviewPerspective): RawReviewLlmOutput {
  return {
    riskScore: 64,
    summary: `Demonstration only - no LLM provider is configured. This is a sample review for the ${perspective} perspective showing the shape of real findings.`,
    findings: [
      {
        severity: 'Critical',
        title: 'Unilateral termination favouring counterparty (demo)',
        excerpt: '"The Company may terminate this Agreement at any time, with or without cause, upon thirty (30) days written notice."',
        law: 'Sec 23 ICA, 1872',
        suggestion: 'Mutual termination right with cure period (15 days) for material breach; carve-out for non-payment.',
      },
      {
        severity: 'Missing',
        title: 'No data-protection clause (demo)',
        excerpt: '',
        law: 'DPDPA 2023',
        suggestion: 'Add DPDPA-compliant clause: lawful basis, deletion on termination, breach notification within 72h.',
      },
    ],
  };
}

// ---------- Memory fallback (no DATABASE_URL) ------------------------------

type MemReview = ContractReview;
const memReviews = new Map<string, Map<string, MemReview>>();
function memBucket(firmId: string): Map<string, MemReview> {
  let b = memReviews.get(firmId);
  if (!b) { b = new Map(); memReviews.set(firmId, b); }
  return b;
}

/** In-memory comment counts mirror the DB count. Bumped/decremented from
 *  review-comments.service.ts via `bumpMemoryCommentCount`. */
export function bumpMemoryCommentCount(firmId: string, reviewId: string, delta: number): void {
  const cur = memBucket(firmId).get(reviewId);
  if (!cur) return;
  cur.commentCount = Math.max(0, cur.commentCount + delta);
}

// ---------- DB read helpers (shared by every call site) --------------------

// postgres-js doesn't compose SQL fragments cleanly, so the joined select
// is repeated inline in each call. Centralising it as a helper keeps every
// returned row carrying the same shape (joined user names + comment count).
//
// The LEFT JOINs for assignee / decided_by may return null when the user
// was deleted; we surface (name='', email='') in that case rather than
// erasing the link entirely, so the UI can show "(removed)" if it wants.

async function fetchReviewById(id: string, firmId: string): Promise<ReviewRow | null> {
  const sql = db();
  if (!sql) return null;
  const rows = await sql<ReviewRow[]>`
    select
      r.id, r.firm_id, r.case_id, r.document_id, r.perspective, r.title,
      r.source_filename, r.source_text, r.status, r.risk_score,
      r.findings_json, r.summary, r.provider, r.error_message,
      r.created_by, r.created_at, r.completed_at,
      r.assigned_to, a.name  as assigned_to_name, a.email as assigned_to_email,
      r.decision, r.decided_at,
      r.decided_by, d.name  as decided_by_name,  d.email as decided_by_email,
      (select count(*) from contract_review_comments c
         where c.review_id = r.id and c.deleted_at is null) as comment_count
    from contract_reviews r
    left join users a on a.id = r.assigned_to
    left join users d on d.id = r.decided_by
    where r.id = ${id}::uuid and r.firm_id = ${firmId}::uuid
    limit 1
  `;
  return rows[0] ?? null;
}

// ---------- Public service --------------------------------------------------

interface CreateArgs extends CreateContractReviewRequest {
  firmId: string;
  createdBy: string | null;
}

interface CaseOwnershipRow { id: string }

async function assertCaseBelongsToFirm(caseId: string, firmId: string): Promise<void> {
  const sql = db();
  if (!sql) return; // in-memory mode trusts the caller
  const rows = await sql<CaseOwnershipRow[]>`
    select id from cases where id = ${caseId}::uuid and firm_id = ${firmId}::uuid limit 1
  `;
  if (rows.length === 0) {
    throw new NotFoundError('Case not found for this firm');
  }
}

async function assertUserBelongsToFirm(userId: string, firmId: string): Promise<void> {
  const sql = db();
  if (!sql) return; // in-memory trusts caller
  const rows = await sql<{ id: string }[]>`
    select id from users where id = ${userId}::uuid and firm_id = ${firmId}::uuid limit 1
  `;
  if (rows.length === 0) {
    throw new UnprocessableEntityError('User is not in this firm');
  }
}

function emptyMemReview(args: {
  id: string;
  firmId: string;
  caseId: string | null;
  documentId: string | null;
  perspective: ReviewPerspective;
  title: string;
  sourceFilename: string | null;
  sourceText: string;
  provider: ResolvedProvider;
  createdBy: string | null;
  createdAt: string;
}): MemReview {
  return {
    id: args.id,
    firmId: args.firmId,
    caseId: args.caseId,
    documentId: args.documentId,
    perspective: args.perspective,
    title: args.title,
    sourceFilename: args.sourceFilename,
    sourceText: args.sourceText,
    status: 'analyzing',
    riskScore: null,
    summary: null,
    provider: args.provider,
    errorMessage: null,
    createdBy: args.createdBy,
    createdAt: args.createdAt,
    completedAt: null,
    findings: [],
    assignedTo: null,
    decision: null,
    decidedAt: null,
    decidedBy: null,
    commentCount: 0,
  };
}

export const reviewService = {
  /** Run a fresh review and persist it. Returns the completed (or failed) row.
   *  The whole pipeline runs inline - no background job - because the LLM
   *  call dominates the latency and the UI is already an explicit "Analyze"
   *  click, not a background pulse. */
  async create(input: CreateArgs): Promise<ContractReview> {
    if (!input.firmId) {
      throw new UnprocessableEntityError('No firm attached - cannot create review');
    }
    if (!input.sourceText || input.sourceText.trim().length < 50) {
      throw new UnprocessableEntityError('sourceText is too short to review (need at least 50 chars)');
    }
    if (input.caseId) {
      await assertCaseBelongsToFirm(input.caseId, input.firmId);
    }

    const title = deriveTitle(input);
    const provider = resolveProvider(input.provider);
    const sql = db();

    // 1) Insert a placeholder row in status='analyzing' so the UI / list view
    //    can show the in-flight review even if the LLM call is slow.
    let id: string;
    if (sql) {
      const rows = await sql<{ id: string }[]>`
        insert into contract_reviews
          (firm_id, case_id, document_id, perspective, title, source_filename,
           source_text, status, provider, created_by)
        values
          (${input.firmId}::uuid,
           ${input.caseId ?? null},
           ${input.documentId ?? null},
           ${input.perspective},
           ${title},
           ${input.sourceFilename ?? null},
           ${input.sourceText},
           'analyzing',
           ${provider},
           ${input.createdBy ?? null})
        returning id
      `;
      id = rows[0]!.id;
    } else {
      id = `mem-${memBucket(input.firmId).size + 1}-${Date.now()}`;
      const now = new Date().toISOString();
      memBucket(input.firmId).set(
        id,
        emptyMemReview({
          id,
          firmId: input.firmId,
          caseId: input.caseId ?? null,
          documentId: input.documentId ?? null,
          perspective: input.perspective,
          title,
          sourceFilename: input.sourceFilename ?? null,
          sourceText: input.sourceText,
          provider,
          createdBy: input.createdBy ?? null,
          createdAt: now,
        }),
      );
    }

    // 2) Call the LLM (or demo). Failures are caught and persisted as
    //    status='failed' - the route layer surfaces them as 201s with the
    //    failed row so the UI can show "Re-run" instead of a generic toast.
    try {
      let parsed: RawReviewLlmOutput;
      if (provider === 'none') {
        parsed = demoOutput(input.perspective);
      } else {
        const prompt = buildPrompt(input.perspective, input.sourceText);
        const result = provider === 'xai' ? await callGrok(prompt) : await callClaude(prompt);
        const raw = result.text;
        aiUsageService.recordAsync({
          firmId: input.firmId, userId: input.createdBy, feature: 'review',
          provider, model: provider === 'anthropic' ? env.ANTHROPIC_MODEL : env.XAI_MODEL,
          tokensIn: result.tokensIn, tokensOut: result.tokensOut,
          cacheReadTokens: result.cacheRead, cacheWriteTokens: result.cacheWrite,
        });
        try {
          parsed = parseLlmJson(raw);
        } catch (err) {
          logger.warn({ err, provider, head: raw.slice(0, 200) }, 'review LLM JSON parse failed');
          throw err;
        }
      }
      return await this._finalize(id, input.firmId, parsed, provider);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'review failed';
      logger.error({ err, reviewId: id }, 'review run failed');
      return await this._fail(id, input.firmId, message);
    }
  },

  /** Internal - promote an analyzing row to completed. */
  async _finalize(
    id: string,
    firmId: string,
    out: RawReviewLlmOutput,
    provider: ResolvedProvider,
  ): Promise<ContractReview> {
    const sql = db();
    if (sql) {
      // sql.json's type rejects arrays of typed objects (it wants an
      // open-shaped JSONObject). Serialise + cast in SQL - same wire
      // representation, no type gymnastics.
      const findingsJson = JSON.stringify(out.findings);
      await sql`
        update contract_reviews set
          status = 'completed',
          risk_score = ${out.riskScore},
          summary = ${out.summary},
          findings_json = ${findingsJson}::jsonb,
          provider = ${provider},
          completed_at = now(),
          error_message = null
        where id = ${id}::uuid and firm_id = ${firmId}::uuid
      `;
      const row = await fetchReviewById(id, firmId);
      if (!row) throw new NotFoundError('Review vanished mid-run');
      return rowToReview(row);
    }
    const bucket = memBucket(firmId);
    const cur = bucket.get(id);
    if (!cur) throw new NotFoundError('Review vanished mid-run');
    const updated: MemReview = {
      ...cur,
      status: 'completed',
      riskScore: out.riskScore,
      summary: out.summary,
      findings: out.findings,
      provider,
      completedAt: new Date().toISOString(),
      errorMessage: null,
    };
    bucket.set(id, updated);
    return updated;
  },

  /** Internal - mark a row as failed. Returned to the caller so the UI can
   *  render the failure inline (with the same id) rather than losing it. */
  async _fail(id: string, firmId: string, message: string): Promise<ContractReview> {
    const sql = db();
    if (sql) {
      await sql`
        update contract_reviews set
          status = 'failed',
          error_message = ${message.slice(0, 1000)},
          completed_at = now()
        where id = ${id}::uuid and firm_id = ${firmId}::uuid
      `;
      const row = await fetchReviewById(id, firmId);
      if (!row) throw new NotFoundError('Review vanished mid-run');
      return rowToReview(row);
    }
    const bucket = memBucket(firmId);
    const cur = bucket.get(id);
    if (!cur) throw new NotFoundError('Review vanished mid-run');
    const updated: MemReview = {
      ...cur,
      status: 'failed',
      errorMessage: message.slice(0, 1000),
      completedAt: new Date().toISOString(),
    };
    bucket.set(id, updated);
    return updated;
  },

  async list(firmId: string | null, caseId?: string): Promise<ListContractReviewsResponse> {
    if (!firmId) return { items: [] };
    const sql = db();
    if (sql) {
      const rows = caseId
        ? await sql<ReviewRow[]>`
            select
              r.id, r.firm_id, r.case_id, r.document_id, r.perspective, r.title,
              r.source_filename, r.source_text, r.status, r.risk_score,
              r.findings_json, r.summary, r.provider, r.error_message,
              r.created_by, r.created_at, r.completed_at,
              r.assigned_to, a.name as assigned_to_name, a.email as assigned_to_email,
              r.decision, r.decided_at,
              r.decided_by, d.name as decided_by_name, d.email as decided_by_email,
              (select count(*) from contract_review_comments c
                 where c.review_id = r.id and c.deleted_at is null) as comment_count
            from contract_reviews r
            left join users a on a.id = r.assigned_to
            left join users d on d.id = r.decided_by
            where r.firm_id = ${firmId}::uuid and r.case_id = ${caseId}::uuid
            order by r.created_at desc
            limit 100
          `
        : await sql<ReviewRow[]>`
            select
              r.id, r.firm_id, r.case_id, r.document_id, r.perspective, r.title,
              r.source_filename, r.source_text, r.status, r.risk_score,
              r.findings_json, r.summary, r.provider, r.error_message,
              r.created_by, r.created_at, r.completed_at,
              r.assigned_to, a.name as assigned_to_name, a.email as assigned_to_email,
              r.decision, r.decided_at,
              r.decided_by, d.name as decided_by_name, d.email as decided_by_email,
              (select count(*) from contract_review_comments c
                 where c.review_id = r.id and c.deleted_at is null) as comment_count
            from contract_reviews r
            left join users a on a.id = r.assigned_to
            left join users d on d.id = r.decided_by
            where r.firm_id = ${firmId}::uuid
            order by r.created_at desc
            limit 100
          `;
      return { items: rows.map(rowToSummary) };
    }
    const all = Array.from(memBucket(firmId).values())
      .filter((r) => !caseId || r.caseId === caseId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100);
    return {
      items: all.map((r): ContractReviewSummary => ({
        id: r.id,
        firmId: r.firmId,
        caseId: r.caseId,
        documentId: r.documentId,
        perspective: r.perspective,
        title: r.title,
        sourceFilename: r.sourceFilename,
        status: r.status,
        riskScore: r.riskScore,
        summary: r.summary,
        provider: r.provider,
        errorMessage: r.errorMessage,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
        assignedTo: r.assignedTo,
        decision: r.decision,
        decidedAt: r.decidedAt,
        decidedBy: r.decidedBy,
        commentCount: r.commentCount,
      })),
    };
  },

  /** Reviewer queue - reviews assigned to a specific user. Same shape as
   *  list(); a separate path keeps the index hint clear and the SQL simple. */
  async mine(userId: string, firmId: string | null): Promise<ListContractReviewsResponse> {
    if (!firmId) return { items: [] };
    const sql = db();
    if (sql) {
      const rows = await sql<ReviewRow[]>`
        select
          r.id, r.firm_id, r.case_id, r.document_id, r.perspective, r.title,
          r.source_filename, r.source_text, r.status, r.risk_score,
          r.findings_json, r.summary, r.provider, r.error_message,
          r.created_by, r.created_at, r.completed_at,
          r.assigned_to, a.name as assigned_to_name, a.email as assigned_to_email,
          r.decision, r.decided_at,
          r.decided_by, d.name as decided_by_name, d.email as decided_by_email,
          (select count(*) from contract_review_comments c
             where c.review_id = r.id and c.deleted_at is null) as comment_count
        from contract_reviews r
        left join users a on a.id = r.assigned_to
        left join users d on d.id = r.decided_by
        where r.firm_id = ${firmId}::uuid and r.assigned_to = ${userId}::uuid
        order by
          -- pending decisions float to the top so the queue shows work, not
          -- archive. Within a bucket, newest first.
          case when r.decision is null or r.decision = 'pending' then 0
               when r.decision = 'changes_requested' then 1
               else 2 end,
          r.created_at desc
        limit 100
      `;
      return { items: rows.map(rowToSummary) };
    }
    const all = Array.from(memBucket(firmId).values())
      .filter((r) => r.assignedTo?.id === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100);
    return {
      items: all.map((r): ContractReviewSummary => ({
        id: r.id,
        firmId: r.firmId,
        caseId: r.caseId,
        documentId: r.documentId,
        perspective: r.perspective,
        title: r.title,
        sourceFilename: r.sourceFilename,
        status: r.status,
        riskScore: r.riskScore,
        summary: r.summary,
        provider: r.provider,
        errorMessage: r.errorMessage,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
        assignedTo: r.assignedTo,
        decision: r.decision,
        decidedAt: r.decidedAt,
        decidedBy: r.decidedBy,
        commentCount: r.commentCount,
      })),
    };
  },

  async get(id: string, firmId: string | null): Promise<ContractReview> {
    if (!firmId) throw new NotFoundError('Review not found');
    const sql = db();
    if (sql) {
      const row = await fetchReviewById(id, firmId);
      if (!row) throw new NotFoundError('Review not found');
      return rowToReview(row);
    }
    const r = memBucket(firmId).get(id);
    if (!r) throw new NotFoundError('Review not found');
    return r;
  },

  /** Lifecycle update - assign a reviewer and/or record a decision. The
   *  authorisation rules:
   *   - Anyone in the firm with `review.approve` (route gate) can assign
   *     OR re-assign.
   *   - Recording a decision (approve / changes_requested) requires being
   *     the current assignee OR not having an assignee set yet. Anything
   *     stricter (only firm admins can approve, etc.) belongs in policy
   *     and isn't enforced here. */
  async updateLifecycle(
    id: string,
    firmId: string | null,
    patch: UpdateReviewLifecycleRequest,
    callerId: string,
  ): Promise<ContractReview> {
    if (!firmId) throw new NotFoundError('Review not found');
    const current = await this.get(id, firmId);
    // Validate assignee belongs to the firm.
    if (patch.assignedTo) {
      await assertUserBelongsToFirm(patch.assignedTo, firmId);
    }
    // Decision authorisation: caller must be the assignee (after applying
    // the same-request reassignment) or there must be no assignee.
    if (patch.decision !== undefined && patch.decision !== null) {
      const effectiveAssignee =
        patch.assignedTo !== undefined ? patch.assignedTo : current.assignedTo?.id ?? null;
      if (effectiveAssignee && effectiveAssignee !== callerId) {
        throw new ForbiddenError(
          'Only the assigned reviewer can record a decision. Re-assign first, or ask the assignee.',
        );
      }
    }

    const sql = db();
    if (sql) {
      const assignedTo = patch.assignedTo !== undefined ? patch.assignedTo : current.assignedTo?.id ?? null;
      const decision = patch.decision !== undefined ? patch.decision : current.decision;
      const decidedBy = decision ? callerId : null;
      // Two parameterised paths so we can either freeze decided_at via
      // now() or wipe it on re-open. Keeping the two branches inline so
      // it's obvious which write path runs.
      if (decision) {
        await sql`
          update contract_reviews set
            assigned_to = ${assignedTo},
            decision = ${decision},
            decided_at = now(),
            decided_by = ${decidedBy}
          where id = ${id}::uuid and firm_id = ${firmId}::uuid
        `;
      } else {
        await sql`
          update contract_reviews set
            assigned_to = ${assignedTo},
            decision = null,
            decided_at = null,
            decided_by = null
          where id = ${id}::uuid and firm_id = ${firmId}::uuid
        `;
      }
      const row = await fetchReviewById(id, firmId);
      if (!row) throw new NotFoundError('Review not found');
      const updated = rowToReview(row);
      // Fire notifications AFTER the write commits. Fire-and-forget - the
      // notifications service catches its own failures, so a logging
      // hiccup never poisons the mutation result.
      void emitLifecycleNotifications(current, updated, callerId);
      return updated;
    }
    // In-memory path mirrors the SQL branches.
    const bucket = memBucket(firmId);
    const cur = bucket.get(id);
    if (!cur) throw new NotFoundError('Review not found');
    const nextAssignee: ReviewAssignee | null = patch.assignedTo === undefined
      ? cur.assignedTo
      : patch.assignedTo === null
        ? null
        : { id: patch.assignedTo, name: '', email: '' };
    const nextDecision = patch.decision !== undefined ? patch.decision : cur.decision;
    const updated: MemReview = {
      ...cur,
      assignedTo: nextAssignee,
      decision: nextDecision,
      decidedAt: nextDecision ? new Date().toISOString() : null,
      decidedBy: nextDecision ? { id: callerId, name: '', email: '' } : null,
    };
    bucket.set(id, updated);
    void emitLifecycleNotifications(current, updated, callerId);
    return updated;
  },

  async remove(id: string, firmId: string | null): Promise<void> {
    if (!firmId) throw new NotFoundError('Review not found');
    const sql = db();
    if (sql) {
      const rows = await sql<{ id: string }[]>`
        delete from contract_reviews
        where id = ${id}::uuid and firm_id = ${firmId}::uuid
        returning id
      `;
      if (rows.length === 0) throw new NotFoundError('Review not found');
      return;
    }
    const bucket = memBucket(firmId);
    if (!bucket.delete(id)) throw new NotFoundError('Review not found');
  },
};

// ---------- Notification fan-out helper ------------------------------------
// Compares the pre/post snapshot of a lifecycle update and emits the right
// notifications. Each path resolves the caller's name once (so the email
// reads "Asha assigned you…" instead of an opaque user id) and skips
// self-notifications - you don't need an email about your own action.

async function resolveDisplayName(userId: string | null): Promise<string> {
  if (!userId) return 'A teammate';
  const sql = db();
  if (!sql) return 'A teammate';
  try {
    const rows = await sql<Array<{ name: string }>>`
      select name from users where id = ${userId}::uuid limit 1
    `;
    return rows[0]?.name ?? 'A teammate';
  } catch (err) {
    logger.warn({ err, userId }, 'resolveDisplayName failed');
    return 'A teammate';
  }
}

async function emitLifecycleNotifications(
  before: ContractReview,
  after: ContractReview,
  callerId: string,
): Promise<void> {
  try {
    const callerName = await resolveDisplayName(callerId);

    // 1) Assignee changed (assigned, re-assigned, or unassigned). Notify the
    //    new assignee - but never the caller themselves, since pinging
    //    yourself for assigning yourself is just noise.
    const newAssigneeId = after.assignedTo?.id ?? null;
    const oldAssigneeId = before.assignedTo?.id ?? null;
    if (newAssigneeId && newAssigneeId !== oldAssigneeId && newAssigneeId !== callerId) {
      await notify.reviewAssigned(newAssigneeId, {
        reviewTitle: after.title,
        assignerName: callerName,
      });
    }

    // 2) Decision transitioned to a final state. Notify whoever requested
    //    the review (createdBy), unless they are the one deciding.
    const decisionChanged = before.decision !== after.decision;
    const isFinal = after.decision === 'approved' || after.decision === 'changes_requested';
    if (decisionChanged && isFinal && after.createdBy && after.createdBy !== callerId) {
      await notify.reviewDecided(after.createdBy, {
        reviewTitle: after.title,
        decision: after.decision as 'approved' | 'changes_requested',
        reviewerName: callerName,
      });
    }
  } catch (err) {
    // Defence in depth - notifications.service.send() already swallows its
    // own errors, but if a synchronous step here throws we don't want it
    // poisoning the mutation result the caller already saw.
    logger.warn({ err, reviewId: after.id }, 'review lifecycle notifications failed');
  }
}

/** Public hook used by review-comments.service.ts so it doesn't need to
 *  duplicate the user-name resolution + skip-self logic. */
export async function emitCommentNotification(args: {
  reviewId: string;
  firmId: string;
  authorId: string;
  body: string;
  parentAuthorId: string | null;
}): Promise<void> {
  try {
    const review = await reviewService.get(args.reviewId, args.firmId);
    const commenterName = await resolveDisplayName(args.authorId);

    // Recipients: review assignee + review createdBy + parent comment's author.
    // Caller is skipped so they don't receive an email for their own post.
    const candidates = new Set<string>();
    if (review.assignedTo?.id) candidates.add(review.assignedTo.id);
    if (review.createdBy) candidates.add(review.createdBy);
    if (args.parentAuthorId) candidates.add(args.parentAuthorId);
    candidates.delete(args.authorId);

    const preview = args.body.length > 140 ? `${args.body.slice(0, 137)}…` : args.body;
    if (candidates.size > 0) {
      await notify.reviewCommentPosted(Array.from(candidates), {
        reviewTitle: review.title,
        commenterName,
        preview,
        isReply: !!args.parentAuthorId,
      });
    }
  } catch (err) {
    logger.warn({ err, reviewId: args.reviewId }, 'review comment notification failed');
  }
}
