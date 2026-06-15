/**
 * mock-arguments.service — AI-opposed oral-advocacy practice.
 *
 * Flow:
 *   1. The user picks a saved case OR uploads a PDF/DOCX. For uploads we run
 *      the same text-extraction pipeline case-notes uses, then ask the LLM
 *      to distil parties / facts / issues / applicable statutes into a
 *      structured "matter summary". The user confirms/edits before starting.
 *   2. The session starts. Each user turn is appended; the service retrieves
 *      relevant statute chunks (lawsSearchService — bge-m3 + RRF), folds them
 *      into a system prompt scoped by the chosen judge persona + the user's
 *      assigned role, and streams a counter-argument back through SSE. The
 *      AI turn is persisted with its citations once the stream finishes.
 *   3. On Conclude, a single LLM call returns a structured review — rubric
 *      scores, strengths, weaknesses, missed arguments, study list — which
 *      is parsed/clamped and persisted into mock_argument_reviews.
 *
 * Context strategy (slice 1):
 *   - Pinned matter summary is always sent.
 *   - The last N=6 turns are sent verbatim.
 *   - No rolling summary in slice 1; turns are short and 6 fits comfortably
 *     into prompt budget for any realistic session. Adding a rolling summary
 *     when turn count grows is a self-contained future slice.
 *
 * Tenant scope:
 *   - Every read/write filters firm_id AND user_id. Sessions are
 *     user-private even within a firm — your colleague's practice runs are
 *     not your business. This is stricter than case-notes (which can be
 *     shared); a future slice can add a `visibility` column if firms ask
 *     for it.
 *
 * No DB / no LLM:
 *   - Without DATABASE_URL the service throws UnprocessableEntityError on
 *     any call. There is no in-memory mock here — the table set is too
 *     interrelated to bother shimming for slice 1 (review.service stubs
 *     in-memory because there's no required relational chain to maintain).
 *   - Without an LLM provider, the prompt callers fall back to deterministic
 *     scaffolding (similar to drafting.service's SAMPLE_TEMPLATE) so the UI
 *     doesn't go blank in dev.
 */

import { db } from '../db/client';
import { env } from '../env';
import { logger } from '../logger';
import { withRetry, HttpRetryError } from '../lib/retry';
import {
  NotFoundError,
  UnprocessableEntityError,
} from '../lib/errors';
import { extractText } from '../lib/text-extraction';
import { languageDirective, isKnownLanguageCode } from '../lib/languages';
import { lawsSearchService, type LawHit } from './laws-search.service';
import { aiUsageService } from './ai-usage.service';
import { anthropicUsage, xaiUsage, type NormalizedUsage } from '../lib/llm-usage';

// ---- shared types ---------------------------------------------------------

export type MaRole =
  | 'petitioner' | 'respondent' | 'prosecution' | 'defense' | 'appellant' | 'appellee';

export type MaJudgePersona = 'neutral' | 'strict' | 'socratic';
export type MaStatus = 'setup' | 'active' | 'concluded' | 'abandoned';
export type MaInputMode = 'voice' | 'text';
export type MaSpeaker = 'user' | 'ai';

/** Citation surfaced into the AI turn bubble's "sources" affordance. */
export interface MaCitation {
  citation: string | null;
  sectionNumber: string | null;
  sectionHeading: string | null;
  actTitle: string | null;
  jurisdiction: LawHit['jurisdiction'];
  state: string | null;
  /** Trimmed excerpt of the chunk content — enough for the UI's expanded
   *  view but bounded so we don't blow up the JSONB column. */
  excerpt: string;
  sourceUrl: string | null;
}

/** Confirmed/editable distillation of the case file. The user reviews this
 *  in the setup step; the active session pins it as system context. */
export interface MaMatterSummary {
  title: string;
  court: string | null;
  parties: { petitioner: string | null; respondent: string | null };
  facts: string[];
  issues: string[];
  applicableStatutes: string[];
  priorJudgments: string[];
}

export interface MaTurn {
  id: string;
  sessionId: string;
  turnNumber: number;
  speaker: MaSpeaker;
  transcript: string;
  citations: MaCitation[] | null;
  /** Per-turn rubric written by the conclude pass. Always null on AI turns
   *  and on user turns until the session has been concluded. */
  rating: MaTurnRating | null;
  createdAt: string;
}

export interface MaSession {
  id: string;
  firmId: string;
  userId: string;
  caseId: string | null;
  uploadId: string | null;
  matterSummary: MaMatterSummary;
  role: MaRole;
  judgePersona: MaJudgePersona;
  plannedDurationSeconds: number | null;
  inputMode: MaInputMode;
  /** BCP-47 code (e.g. 'en-IN', 'ta-IN'). Pinned at session creation and
   *  threaded into every LLM prompt so the opposing-counsel turns and the
   *  review come out in the chosen language. Defaults to 'en-IN'. */
  languageCode: string;
  status: MaStatus;
  startedAt: string;
  endedAt: string | null;
  overallScore: number | null;
  /** Compressed digest of turns up to `lastSummarizedTurn`. The active session
   *  sends this + the most-recent verbatim turns to keep the prompt bounded. */
  rollingSummary: string | null;
  lastSummarizedTurn: number;
  createdAt: string;
  updatedAt: string;
}

export interface MaSessionWithTurns extends MaSession {
  turns: MaTurn[];
  review: MaReview | null;
}

export interface MaSessionSummary {
  id: string;
  caseId: string | null;
  uploadId: string | null;
  matterTitle: string;
  /** Name of the advocate who prepared / started the session. Joined from
   *  the users table at list time so the landing card can lead with "who"
   *  before "what". Falls back to an empty string if the user row is gone. */
  preparedByName: string;
  role: MaRole;
  judgePersona: MaJudgePersona;
  /** BCP-47 language of the session — surfaced on the row so a multi-lingual
   *  practitioner can distinguish their Tamil session from their English one
   *  at a glance. */
  languageCode: string;
  status: MaStatus;
  startedAt: string;
  endedAt: string | null;
  overallScore: number | null;
  turnCount: number;
}

export interface MaUpload {
  id: string;
  fileName: string;
  fileMime: string;
  fileSize: number;
  extractionStatus: 'pending' | 'ok' | 'failed';
  extractionError: string | null;
  createdAt: string;
  /** LLM-derived summary returned alongside the upload row so the client
   *  can pre-fill the setup form. Empty if extraction failed. */
  summary: MaMatterSummary;
}

/** Per-user-turn rubric written into mock_argument_turns.rating_jsonb when
 *  the session is concluded. Same dimensions as the aggregate rubric, scoped
 *  to a single turn, plus an optional one-line LLM comment. */
export interface MaTurnRating {
  legalSoundness: number;
  citationUse: number;
  structure: number;
  persuasiveness: number;
  responsiveness: number;
  comment: string;
}

export interface MaReview {
  id: string;
  sessionId: string;
  rubric: {
    legalSoundness: number;        // 0–5
    citationUse: number;           // 0–5
    structure: number;             // 0–5
    persuasiveness: number;        // 0–5
    responsiveness: number;        // 0–5
    overall: number;               // 0–100
  };
  strengths: string[];
  weaknesses: string[];
  missedArguments: Array<{ point: string; statute?: string; judgment?: string; why?: string }>;
  studyList: Array<{ title: string; citation?: string; why?: string }>;
  /** "Where to improve" — concrete rewrites of the user's weakest turns,
   *  each with the dimensions it would lift and an estimated overall-score
   *  gain. Empty when the model didn't produce any. */
  improvements: MaImprovement[];
  qualitativeSummary: string;
  generatedAt: string;
  /** Raw text the LLM returned for this run. Null on review rows that
   *  predate migration 0037. Surfaced in the UI as a diagnostic
   *  disclosure when the parsed rubric is empty so the user can see
   *  exactly what the model produced. */
  llmRawResponse: string | null;
}

export interface MaImprovement {
  /** 1-indexed user-turn position the suggestion targets. */
  turnNumber: number;
  /** Which rubric dimensions the rewrite would lift. */
  weakDimensions: string[];
  /** Verbatim quote (or close paraphrase) of the weakest part of what the
   *  user actually said — anchors the suggestion to a concrete spot. */
  currentExcerpt: string;
  /** The rewritten line(s) in the advocate's first-person voice. */
  betterVersion: string;
  /** One short sentence on why the rewrite scores higher. */
  rationale: string;
  /** Estimated overall-score points (0-100 scale) this rewrite would add. */
  projectedLift: number;
}

// ---- context ---------------------------------------------------------------

export interface MaCtx { firmId: string; userId: string }

function sqlOrThrow(): NonNullable<ReturnType<typeof db>> {
  const sql = db();
  if (!sql) {
    throw new UnprocessableEntityError(
      'Mock Arguments requires DATABASE_URL — the in-memory fallback is not supported for this feature.',
    );
  }
  return sql;
}

// ---- row → DTO helpers -----------------------------------------------------

interface SessionRow {
  id: string;
  firm_id: string;
  user_id: string;
  case_id: string | null;
  upload_id: string | null;
  matter_summary_jsonb: unknown;
  role: MaRole;
  judge_persona: MaJudgePersona;
  planned_duration_seconds: number | null;
  input_mode: MaInputMode;
  /** Migration 0039. Defaults to 'en-IN' on rows that predate it. */
  language_code: string;
  status: MaStatus;
  started_at: string | Date;
  ended_at: string | Date | null;
  overall_score: string | number | null;
  /** Migration 0036 — null until the first regeneration. */
  rolling_summary: string | null;
  last_summarized_turn: number;
  created_at: string | Date;
  updated_at: string | Date;
}

interface TurnRow {
  id: string;
  session_id: string;
  turn_number: number;
  speaker: MaSpeaker;
  transcript: string;
  citations_jsonb: unknown;
  rating_jsonb: unknown;
  created_at: string | Date;
}

interface ReviewRow {
  id: string;
  session_id: string;
  rubric_jsonb: unknown;
  strengths: string[];
  weaknesses: string[];
  missed_arguments_jsonb: unknown;
  study_list_jsonb: unknown;
  improvements_jsonb: unknown;
  qualitative_summary: string | null;
  generated_at: string | Date;
  llm_raw_response: string | null;
}

function iso(v: string | Date | null): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function isoReq(v: string | Date): string {
  return iso(v)!;
}

function asMatterSummary(raw: unknown): MaMatterSummary {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const parties = (obj.parties && typeof obj.parties === 'object'
    ? obj.parties as Record<string, unknown>
    : {});
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    title: typeof obj.title === 'string' ? obj.title : '',
    court: typeof obj.court === 'string' ? obj.court : null,
    parties: {
      petitioner: typeof parties.petitioner === 'string' ? parties.petitioner : null,
      respondent: typeof parties.respondent === 'string' ? parties.respondent : null,
    },
    facts: arr(obj.facts),
    issues: arr(obj.issues),
    applicableStatutes: arr(obj.applicableStatutes),
    priorJudgments: arr(obj.priorJudgments),
  };
}

function asCitations(raw: unknown): MaCitation[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((c) => ({
      citation: typeof c.citation === 'string' ? c.citation : null,
      sectionNumber: typeof c.sectionNumber === 'string' ? c.sectionNumber : null,
      sectionHeading: typeof c.sectionHeading === 'string' ? c.sectionHeading : null,
      actTitle: typeof c.actTitle === 'string' ? c.actTitle : null,
      jurisdiction: (c.jurisdiction === 'Central' || c.jurisdiction === 'State'
        ? c.jurisdiction : 'Unknown') as LawHit['jurisdiction'],
      state: typeof c.state === 'string' ? c.state : null,
      excerpt: typeof c.excerpt === 'string' ? c.excerpt : '',
      sourceUrl: typeof c.sourceUrl === 'string' ? c.sourceUrl : null,
    }));
}

function rowToSession(r: SessionRow): MaSession {
  return {
    id: r.id,
    firmId: r.firm_id,
    userId: r.user_id,
    caseId: r.case_id,
    uploadId: r.upload_id,
    matterSummary: asMatterSummary(r.matter_summary_jsonb),
    role: r.role,
    judgePersona: r.judge_persona,
    plannedDurationSeconds: r.planned_duration_seconds,
    inputMode: r.input_mode,
    languageCode: r.language_code ?? 'en-IN',
    status: r.status,
    startedAt: isoReq(r.started_at),
    endedAt: iso(r.ended_at),
    overallScore: r.overall_score == null ? null : Number(r.overall_score),
    rollingSummary: r.rolling_summary,
    lastSummarizedTurn: r.last_summarized_turn,
    createdAt: isoReq(r.created_at),
    updatedAt: isoReq(r.updated_at),
  };
}

function asTurnRating(raw: unknown): MaTurnRating | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  // Anything that doesn't smell like a rating (no 0-5 number fields) is
  // dropped — better than rendering an empty grid of 0s in the UI.
  if (
    typeof r.legalSoundness !== 'number'
    && typeof r.persuasiveness !== 'number'
  ) {
    return null;
  }
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(5, n));
  };
  return {
    legalSoundness: num(r.legalSoundness),
    citationUse:    num(r.citationUse),
    structure:      num(r.structure),
    persuasiveness: num(r.persuasiveness),
    responsiveness: num(r.responsiveness),
    comment:        typeof r.comment === 'string' ? r.comment : '',
  };
}

function rowToTurn(r: TurnRow): MaTurn {
  return {
    id: r.id,
    sessionId: r.session_id,
    turnNumber: r.turn_number,
    speaker: r.speaker,
    transcript: r.transcript,
    citations: asCitations(r.citations_jsonb),
    rating: asTurnRating(r.rating_jsonb),
    createdAt: isoReq(r.created_at),
  };
}

/** Extract a numeric score from `v` whether it arrives as a JSON number,
 *  a numeric string ("4"), or a string with a number embedded ("4/5",
 *  "4 out of 5", "Score: 4"). Returns NaN when nothing usable is found. */
function extractNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    // Match the first integer or decimal in the string. Handles
    // "4", "4.5", "4/5", "4 out of 5", "Score: 4", "★★★★ (4)".
    const m = v.match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : Number.NaN;
  }
  return Number.NaN;
}

/**
 * Defensive rubric reader. The LLM was asked for a specific shape but
 * different models / prompt iterations sometimes flatten or rename keys
 * or return scores as decorated strings. We try every plausible location
 * before falling back to 0, and compute `overall` from the dimension
 * average when the model omitted it (otherwise the donut shows a
 * meaningless 0 even though the per-dimension scores are all positive).
 */
function coerceRubric(raw: unknown): MaReview['rubric'] {
  // 1. Unwrap one level of nesting. The model may emit
  //    `{ rubric: {...} }` (the spec) or just the dimensions at the top
  //    level or one more level deep under `rubric.scores`.
  const top = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const layer1 = (top.rubric && typeof top.rubric === 'object')
    ? top.rubric as Record<string, unknown>
    : top;
  const r = (layer1.scores && typeof layer1.scores === 'object')
    ? layer1.scores as Record<string, unknown>
    : layer1;

  const num5 = (v: unknown): number => {
    const n = extractNumber(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(5, n));
  };
  const num100 = (v: unknown): number => {
    const n = extractNumber(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  };
  /** Pick a value by camelCase OR snake_case OR space-separated key. */
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) if (r[k] !== undefined) return r[k];
    return undefined;
  };

  const legalSoundness = num5(pick('legalSoundness', 'legal_soundness', 'legal soundness', 'legal'));
  const citationUse    = num5(pick('citationUse',    'citation_use',    'citation use', 'citations'));
  const structure      = num5(pick('structure'));
  const persuasiveness = num5(pick('persuasiveness', 'persuasive'));
  const responsiveness = num5(pick('responsiveness', 'responsive'));

  let overall = num100(pick('overall', 'overall_score', 'overallScore', 'score'));
  if (overall === 0) {
    // Compute from dim average if the LLM omitted overall but provided
    // any non-zero dimensions. 5-scale → 100-scale by multiplying by 20.
    const dims = [legalSoundness, citationUse, structure, persuasiveness, responsiveness];
    const anyPositive = dims.some((d) => d > 0);
    if (anyPositive) {
      const avg = dims.reduce((a, b) => a + b, 0) / dims.length;
      overall = Math.round(avg * 20);
    }
  }

  return { legalSoundness, citationUse, structure, persuasiveness, responsiveness, overall };
}

const VALID_DIM_KEYS = new Set([
  'legalSoundness', 'citationUse', 'structure', 'persuasiveness', 'responsiveness',
]);

/** Defensive parser for the "improvements" array. Drops items missing the
 *  required text fields; clamps `projectedLift` to a sane window so a
 *  hallucinated 999 doesn't blow up the UI. */
function coerceImprovements(raw: unknown): MaImprovement[] {
  if (!Array.isArray(raw)) return [];
  const out: MaImprovement[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const turnNumber = (() => {
      const n = extractNumber(e.turnNumber);
      return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 0;
    })();
    const currentExcerpt = typeof e.currentExcerpt === 'string' ? e.currentExcerpt.slice(0, 600) : '';
    const betterVersion  = typeof e.betterVersion  === 'string' ? e.betterVersion.slice(0, 1200) : '';
    const rationale      = typeof e.rationale      === 'string' ? e.rationale.slice(0, 400) : '';
    const projectedLift  = (() => {
      const n = extractNumber(e.projectedLift);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(30, Math.round(n)));
    })();
    const weakDimensions = Array.isArray(e.weakDimensions)
      ? (e.weakDimensions as unknown[])
          .filter((d): d is string => typeof d === 'string' && VALID_DIM_KEYS.has(d))
          .slice(0, 5)
      : [];
    // An improvement without a betterVersion or currentExcerpt has nothing
    // actionable — skip rather than render an empty card.
    if (!betterVersion.trim() || !currentExcerpt.trim()) continue;
    out.push({ turnNumber, weakDimensions, currentExcerpt, betterVersion, rationale, projectedLift });
  }
  return out.slice(0, 6);
}

/** Fallback: when the top-level rubric is empty/zero but the model DID
 *  produce per-turn ratings, average those into an aggregate. Better than
 *  giving up entirely and showing all 0s when there's per-turn data right
 *  there. Returns null if perTurn is empty / unparseable. */
function aggregateFromPerTurn(
  perTurn: Map<number, MaTurnRating>,
): MaReview['rubric'] | null {
  if (perTurn.size === 0) return null;
  const ratings = [...perTurn.values()];
  const avg = (pick: (r: MaTurnRating) => number): number => {
    const sum = ratings.reduce((a, r) => a + pick(r), 0);
    return sum / ratings.length;
  };
  const legalSoundness = avg((r) => r.legalSoundness);
  const citationUse    = avg((r) => r.citationUse);
  const structure      = avg((r) => r.structure);
  const persuasiveness = avg((r) => r.persuasiveness);
  const responsiveness = avg((r) => r.responsiveness);
  const dims = [legalSoundness, citationUse, structure, persuasiveness, responsiveness];
  if (dims.every((d) => d === 0)) return null;
  return {
    legalSoundness,
    citationUse,
    structure,
    persuasiveness,
    responsiveness,
    overall: Math.round((dims.reduce((a, b) => a + b, 0) / dims.length) * 20),
  };
}

/**
 * Resolve the canonical rubric for a review row.
 *
 * Read order:
 *   1. If `llm_raw_response` is present, re-parse it on every read and
 *      run coerceRubric (+ perTurn aggregation fallback) against the
 *      fresh parse. This makes parser improvements apply retroactively
 *      without a re-run, AND sidesteps any rows whose `rubric_jsonb`
 *      ended up empty / wrong from an earlier persist.
 *   2. Otherwise fall back to `rubric_jsonb` as stored.
 *
 * The persisted `rubric_jsonb` is kept as a write-time cache so the
 * landing page (which only needs `overall_score` from the sessions row)
 * stays fast — we only do the re-parse on the detail-view path.
 */
function rubricFromRow(r: ReviewRow): MaReview['rubric'] {
  if (r.llm_raw_response) {
    const parsed = parseJsonObject(r.llm_raw_response);
    if (parsed) {
      const fresh = coerceRubric(parsed);
      const allZero = (rb: MaReview['rubric']): boolean =>
        rb.legalSoundness === 0 && rb.citationUse === 0 && rb.structure === 0
        && rb.persuasiveness === 0 && rb.responsiveness === 0;
      if (!allZero(fresh)) return fresh;
      // Try perTurn aggregation as a last resort, same as distilReview's
      // first-write path.
      const perTurn = coercePerTurnArray(parsed.perTurn);
      const aggregated = aggregateFromPerTurn(perTurn);
      if (aggregated) return aggregated;
    }
  }
  return coerceRubric(r.rubric_jsonb);
}

/** Same pattern as rubricFromRow: prefer re-parsing improvements from the
 *  saved raw response so prompt/parser improvements apply retroactively
 *  to rows that predate this column or were persisted with stale data. */
function improvementsFromRow(r: ReviewRow): MaImprovement[] {
  if (r.llm_raw_response) {
    const parsed = parseJsonObject(r.llm_raw_response);
    if (parsed) {
      const fresh = coerceImprovements(parsed.improvements);
      if (fresh.length > 0) return fresh;
    }
  }
  return coerceImprovements(r.improvements_jsonb);
}

function rowToReview(r: ReviewRow): MaReview {
  return {
    id: r.id,
    sessionId: r.session_id,
    rubric: rubricFromRow(r),
    strengths: r.strengths ?? [],
    weaknesses: r.weaknesses ?? [],
    missedArguments: Array.isArray(r.missed_arguments_jsonb)
      ? r.missed_arguments_jsonb as MaReview['missedArguments']
      : [],
    studyList: Array.isArray(r.study_list_jsonb)
      ? r.study_list_jsonb as MaReview['studyList']
      : [],
    improvements: improvementsFromRow(r),
    qualitativeSummary: r.qualitative_summary ?? '',
    generatedAt: isoReq(r.generated_at),
    llmRawResponse: r.llm_raw_response,
  };
}

// ---- LLM plumbing ----------------------------------------------------------
// Mirrors drafting.service / review.service: prefer xAI when both keys are
// set (env.llmProvider). Both providers go through the same JSON parser.

interface PromptPair { system: string; user: string }

interface LlmResult extends NormalizedUsage {
  text: string;
}

/** Optional token-usage sink threaded through the LLM helpers so callers that
 *  hold a MaCtx can record AI spend. */
type UsageSink = (u: NormalizedUsage) => void;

/** Build a usage sink that records against ai_token_usage for this feature. */
function usageSink(ctx: MaCtx | undefined): UsageSink | undefined {
  if (!ctx) return undefined;
  return (u) =>
    aiUsageService.recordAsync({
      firmId: ctx.firmId, userId: ctx.userId, feature: 'mock_arguments',
      provider: env.llmProvider,
      model: env.llmProvider === 'anthropic' ? env.ANTHROPIC_MODEL : env.XAI_MODEL,
      tokensIn: u.tokensIn, tokensOut: u.tokensOut,
      cacheReadTokens: u.cacheRead, cacheWriteTokens: u.cacheWrite,
    });
}

async function callJsonClaude(prompt: PromptPair, maxTokens = 2048): Promise<LlmResult> {
  return withRetry(
    async () => {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: env.ANTHROPIC_MODEL,
          max_tokens: maxTokens,
          system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: prompt.user }],
        }),
      });
      if (!r.ok) throw new HttpRetryError(r.status, `Claude ${r.status}: ${await r.text()}`);
      const data = (await r.json()) as {
        content: Array<{ type: string; text: string }>;
        usage?: Parameters<typeof anthropicUsage>[0];
      };
      const text = data.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
      return { text, ...anthropicUsage(data.usage) };
    },
    { onRetry: (err, attempt) => logger.warn({ err, attempt }, 'mock-args Claude retry') },
  );
}

async function callJsonGrok(prompt: PromptPair, maxTokens = 2048): Promise<LlmResult> {
  return withRetry(
    async () => {
      const r = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.XAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.XAI_MODEL,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
        }),
      });
      if (!r.ok) throw new HttpRetryError(r.status, `xAI ${r.status}: ${await r.text()}`);
      const data = (await r.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage?: Parameters<typeof xaiUsage>[0];
      };
      return {
        text: data.choices[0]?.message?.content ?? '',
        ...xaiUsage(data.usage),
      };
    },
    { onRetry: (err, attempt) => logger.warn({ err, attempt }, 'mock-args Grok retry') },
  );
}

async function callJson(prompt: PromptPair, maxTokens = 2048, onUsage?: UsageSink): Promise<string | null> {
  if (env.llmProvider === 'none') return null;
  const result = env.llmProvider === 'xai'
    ? await callJsonGrok(prompt, maxTokens)
    : await callJsonClaude(prompt, maxTokens);
  onUsage?.({ tokensIn: result.tokensIn, tokensOut: result.tokensOut, cacheRead: result.cacheRead, cacheWrite: result.cacheWrite });
  return result.text;
}

function stripFences(text: string): string {
  const t = text.trim();
  if (t.startsWith('```')) {
    return t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  return t;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const stripped = stripFences(raw);
  let candidate = stripped;
  if (!candidate.startsWith('{')) {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first !== -1 && last > first) candidate = candidate.slice(first, last + 1);
  }
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// ---- prompts ---------------------------------------------------------------

function judgeStyle(persona: MaJudgePersona): string {
  switch (persona) {
    case 'strict':
      return 'You are a stern bench: terse, impatient with weak reasoning, and you cut off rambling. You demand precise statute references.';
    case 'socratic':
      return 'You probe with pointed questions before stating your position. You force the advocate to expose hidden assumptions in their argument.';
    case 'neutral':
    default:
      return 'You are firm but fair. You acknowledge a good point, then press its weakest assumption.';
  }
}

function opposingRole(role: MaRole): string {
  switch (role) {
    case 'petitioner':  return 'respondent';
    case 'respondent':  return 'petitioner';
    case 'prosecution': return 'defense';
    case 'defense':     return 'prosecution';
    case 'appellant':   return 'appellee';
    case 'appellee':    return 'appellant';
  }
}

function renderMatterSummary(s: MaMatterSummary): string {
  const lines: string[] = [];
  if (s.title)             lines.push(`Case: ${s.title}`);
  if (s.court)             lines.push(`Court: ${s.court}`);
  if (s.parties.petitioner) lines.push(`Petitioner: ${s.parties.petitioner}`);
  if (s.parties.respondent) lines.push(`Respondent: ${s.parties.respondent}`);
  if (s.facts.length)      lines.push(`Facts:\n- ${s.facts.join('\n- ')}`);
  if (s.issues.length)     lines.push(`Issues:\n- ${s.issues.join('\n- ')}`);
  if (s.applicableStatutes.length)
    lines.push(`Applicable statutes:\n- ${s.applicableStatutes.join('\n- ')}`);
  if (s.priorJudgments.length)
    lines.push(`Prior authorities:\n- ${s.priorJudgments.join('\n- ')}`);
  return lines.join('\n');
}

function renderCitationBlock(hits: LawHit[]): string {
  if (hits.length === 0) return '(no statute matches retrieved)';
  return hits.map((h, i) => {
    const head = h.citation ?? `${h.actTitle ?? 'Act'} § ${h.sectionNumber ?? '?'}`;
    const heading = h.sectionHeading ? ` — ${h.sectionHeading}` : '';
    const body = h.content.slice(0, 700).replace(/\s+/g, ' ').trim();
    return `[${i + 1}] ${head}${heading}\n${body}`;
  }).join('\n\n');
}

interface TurnContextOpts {
  matterSummary: MaMatterSummary;
  role: MaRole;
  judgePersona: MaJudgePersona;
  /** BCP-47 language the AI must respond in. The rolling-summary and the
   *  retrieved-law chunks stay in their source language (English) — only
   *  the AI's reply is forced into the user's language. */
  languageCode: string;
  /** Compressed digest of all turns up to `lastSummarizedTurn`. Empty
   *  when no rolling summary has been generated yet (slice 1 sessions, or
   *  sessions with fewer than 8 turns). */
  rollingSummary: string;
  /** Verbatim turns from `lastSummarizedTurn + 1` up to the current user turn,
   *  ordered by turn_number ascending. The most recent user turn (the one
   *  the AI is replying to) is excluded — it lives in `currentUserTurn`. */
  recentTurns: Array<{ speaker: MaSpeaker; transcript: string }>;
  /** Latest user turn the AI must answer. */
  currentUserTurn: string;
  retrievedLaws: LawHit[];
}

function buildTurnPrompt(opts: TurnContextOpts): PromptPair {
  const userRole = opts.role;
  const aiRole = opposingRole(opts.role);
  const system = `${judgeStyle(opts.judgePersona)}

You are also acting as opposing counsel for the ${aiRole}. Your interlocutor represents the ${userRole}.
Respond in ONE turn (120–220 words). Counter their argument directly:
  - name the strongest weakness in what they just said,
  - state your position with reasoning,
  - cite specific Indian statute sections or leading judgments by name when available (use the retrieved chunks below — do NOT invent citations),
  - end with one pointed question or demand the advocate must answer next.
Speak as a courtroom advocate, not a chatbot. No greetings, no markdown, no headers. Plain prose only.${languageDirective(opts.languageCode)}

# Case context (pinned)
${renderMatterSummary(opts.matterSummary)}

# Retrieved statute / judgment chunks (use these, do not invent others)
${renderCitationBlock(opts.retrievedLaws)}`;

  const recent = opts.recentTurns
    .map((t) => `${t.speaker === 'user' ? `Advocate (${userRole})` : `You (${aiRole})`}: ${t.transcript}`)
    .join('\n\n');

  const summaryBlock = opts.rollingSummary
    ? `# Summary of earlier exchange
${opts.rollingSummary}

`
    : '';

  const user = `${summaryBlock}# Recent exchange
${recent || '(this is the first turn)'}

# The advocate just said
${opts.currentUserTurn}

Reply now as opposing counsel.`;

  return { system, user };
}

// ---- rolling summary -------------------------------------------------------
//
// Goal: keep prompts bounded as a session grows. We always send the pinned
// matter summary + a rolling summary of older turns + the most-recent N
// verbatim turns. The verbatim window absorbs all turns since the last
// summary regeneration, so no turn is ever silently dropped from context.
//
// Algorithm (run after persisting each AI turn):
//   eligible = totalTurns - KEEP_VERBATIM_TURNS
//   if (eligible > 0 && totalTurns - lastSummarizedTurn >= REGEN_TRIGGER) {
//     summarise turns 1..eligible into rolling_summary
//     last_summarized_turn := eligible
//   }
//
// With KEEP_VERBATIM=4 and REGEN_TRIGGER=8, regen fires every 8 turns from
// the previous checkpoint, never strands a turn outside both summary and
// verbatim, and keeps the verbatim window between 4 and ~8 turns.

const KEEP_VERBATIM_TURNS = 4;
const REGEN_TRIGGER = 8;

const ROLLING_SUMMARY_SYSTEM = `You compress an in-progress courtroom mock-argument into a tight third-person summary. Capture the most-load-bearing claims and concessions from both advocates so a downstream prompt can stay coherent without re-reading the full transcript. Plain prose, 6–10 sentences, no markdown.`;

async function summariseTurns(
  matterTitle: string,
  turns: Array<{ speaker: MaSpeaker; transcript: string }>,
  usageCtx?: MaCtx,
): Promise<string> {
  if (turns.length === 0) return '';
  const rendered = turns
    .map((t) => `${t.speaker === 'user' ? 'Advocate' : 'Opposing'}: ${t.transcript}`)
    .join('\n\n');
  const user = `Matter: ${matterTitle}

Transcript so far (compress this into the summary requested):

${rendered}`;
  const raw = await callJson({ system: ROLLING_SUMMARY_SYSTEM, user }, 800, usageSink(usageCtx)).catch((err) => {
    logger.warn({ err }, 'mock-args rolling summary LLM failed');
    return null;
  });
  if (!raw) return '';
  // The summary endpoint asks for plain prose; if the model wrapped it in
  // accidental JSON we strip the fence and salvage whatever's inside.
  return stripFences(raw).slice(0, 2000);
}

/**
 * Decide if the rolling summary needs regenerating; if so, run the LLM and
 * persist the new summary + checkpoint. Returns silently when the trigger
 * hasn't fired or when no LLM provider is configured. Called after every
 * AI turn persists.
 *
 * `session` is the snapshot from BEFORE the user/AI turn pair was added —
 * we re-query the current total turn count here so the comparison reflects
 * the freshly-incremented state.
 */
async function maybeRegenerateSummary(
  sql: NonNullable<ReturnType<typeof db>>,
  sessionId: string,
  ctx: MaCtx,
  session: MaSession,
): Promise<void> {
  if (env.llmProvider === 'none') return;
  try {
    const countRows = await sql<Array<{ count: string | number }>>`
      select count(*) as count from mock_argument_turns
      where session_id = ${sessionId}::uuid
    `;
    const totalTurns = Number(countRows[0]?.count ?? 0);
    if (totalTurns - session.lastSummarizedTurn < REGEN_TRIGGER) return;

    const eligible = totalTurns - KEEP_VERBATIM_TURNS;
    if (eligible <= session.lastSummarizedTurn) return;

    const rows = await sql<Array<{ speaker: MaSpeaker; transcript: string }>>`
      select speaker, transcript from mock_argument_turns
      where session_id = ${sessionId}::uuid
        and turn_number <= ${eligible}
      order by turn_number asc
    `;
    const newSummary = await summariseTurns(session.matterSummary.title, rows, ctx);
    if (!newSummary) return;

    await sql`
      update mock_argument_sessions set
        rolling_summary = ${newSummary},
        last_summarized_turn = ${eligible}
      where id = ${sessionId}::uuid
        and firm_id = ${ctx.firmId}::uuid
        and user_id = ${ctx.userId}::uuid
    `;
  } catch (err) {
    logger.warn({ err, sessionId }, 'mock-args rolling-summary regen failed (non-fatal)');
  }
}

function fallbackAiTurn(opts: TurnContextOpts): string {
  const ai = opposingRole(opts.role);
  return `[Demonstration mode — no LLM provider configured]
As counsel for the ${ai}, I would press the weakest premise of what my friend has argued and ask the court to consider the statutory text directly. Without an active LLM key, I cannot generate a substantive reply; configure ANTHROPIC_API_KEY or XAI_API_KEY in apps/api/.env to enable real opposing counsel.`;
}

// ---- streaming Claude turn ------------------------------------------------

async function* streamClaudeTurn(prompt: PromptPair, onUsage?: UsageSink): AsyncGenerator<string, void, void> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 1024,
      stream: true,
      system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt.user }],
    }),
  });
  if (!r.ok || !r.body) throw new Error(`Claude stream ${r.status}: ${r.body ? await r.text() : ''}`);

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: NormalizedUsage = {};
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf('\n\n');
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload) as {
            type?: string;
            delta?: { type?: string; text?: string };
            message?: { usage?: Parameters<typeof anthropicUsage>[0] };
            usage?: { output_tokens?: number };
          };
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
            yield evt.delta.text;
          } else if (evt.type === 'message_start' && evt.message?.usage) {
            usage = anthropicUsage(evt.message.usage);
          } else if (evt.type === 'message_delta' && evt.usage?.output_tokens != null) {
            usage = { ...usage, tokensOut: evt.usage.output_tokens };
          }
        } catch {
          // ignore malformed frames
        }
      }
    }
  }
  onUsage?.(usage);
}

async function* streamGrokTurn(prompt: PromptPair, onUsage?: UsageSink): AsyncGenerator<string, void, void> {
  const r = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.XAI_MODEL,
      max_tokens: 1024,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
  });
  if (!r.ok || !r.body) throw new Error(`xAI stream ${r.status}: ${r.body ? await r.text() : ''}`);

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: NormalizedUsage = {};
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf('\n\n');
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: Parameters<typeof xaiUsage>[0];
          };
          const t = evt.choices?.[0]?.delta?.content;
          if (t) yield t;
          if (evt.usage) usage = xaiUsage(evt.usage);
        } catch {
          // ignore
        }
      }
    }
  }
  onUsage?.(usage);
}

async function* streamTurnFromProvider(prompt: PromptPair, onUsage?: UsageSink): AsyncGenerator<string, void, void> {
  if (env.llmProvider === 'xai') {
    yield* streamGrokTurn(prompt, onUsage);
    return;
  }
  yield* streamClaudeTurn(prompt, onUsage);
}

// ----------------------------------------------------------------------------
// Public service
// ----------------------------------------------------------------------------

/** Light projection of a LawHit that we persist inside the AI turn row. We
 *  don't carry the full chunk content (the JSONB column would balloon) —
 *  ~600 chars of excerpt is enough for the UI's "sources" disclosure. */
function projectCitation(h: LawHit): MaCitation {
  return {
    citation: h.citation,
    sectionNumber: h.sectionNumber,
    sectionHeading: h.sectionHeading,
    actTitle: h.actTitle,
    jurisdiction: h.jurisdiction,
    state: h.state,
    excerpt: h.content.slice(0, 600),
    sourceUrl: h.sourceUrl,
  };
}

async function caseBelongsToFirm(caseId: string, firmId: string): Promise<boolean> {
  const sql = sqlOrThrow();
  const rows = await sql<Array<{ id: string }>>`
    select id from cases where id = ${caseId}::uuid and firm_id = ${firmId}::uuid limit 1
  `;
  return rows.length > 0;
}

async function uploadBelongsToFirm(uploadId: string, firmId: string): Promise<boolean> {
  const sql = sqlOrThrow();
  const rows = await sql<Array<{ id: string }>>`
    select id from mock_argument_uploads
    where id = ${uploadId}::uuid and firm_id = ${firmId}::uuid
    limit 1
  `;
  return rows.length > 0;
}

async function loadOwnedSession(sessionId: string, ctx: MaCtx): Promise<SessionRow> {
  const sql = sqlOrThrow();
  const rows = await sql<SessionRow[]>`
    select * from mock_argument_sessions
    where id = ${sessionId}::uuid
      and firm_id = ${ctx.firmId}::uuid
      and user_id = ${ctx.userId}::uuid
    limit 1
  `;
  const r = rows[0];
  if (!r) throw new NotFoundError('Session not found');
  return r;
}

// ---- summary distillation --------------------------------------------------

const SUMMARY_SYSTEM = `You distil Indian-court case files into a structured matter summary used by a mock-argument practice tool. Read the case context and return STRICT JSON with this exact shape — no prose, no markdown, no code fences:

{
  "title": "<short case title>",
  "court": "<court name or null>",
  "parties": { "petitioner": "<name or null>", "respondent": "<name or null>" },
  "facts": ["<short fact 1>", "<short fact 2>", ...],
  "issues": ["<legal issue 1>", ...],
  "applicableStatutes": ["BNS s.103", "Indian Contract Act s.74", ...],
  "priorJudgments": ["<case name with citation if known>", ...]
}

Keep arrays to at most 8 items each. Be concrete and concise.`;

async function distilSummary(rawText: string, fallbackTitle: string, usageCtx?: MaCtx): Promise<MaMatterSummary> {
  if (!rawText.trim()) {
    return {
      title: fallbackTitle,
      court: null,
      parties: { petitioner: null, respondent: null },
      facts: [],
      issues: [],
      applicableStatutes: [],
      priorJudgments: [],
    };
  }
  const user = `Distil the matter summary from the following case material:\n\n${rawText.slice(0, 30_000)}`;
  const raw = await callJson({ system: SUMMARY_SYSTEM, user }, 1024, usageSink(usageCtx)).catch((err) => {
    logger.warn({ err }, 'mock-args summary LLM failed');
    return null;
  });
  if (!raw) {
    return {
      title: fallbackTitle,
      court: null,
      parties: { petitioner: null, respondent: null },
      facts: [],
      issues: [],
      applicableStatutes: [],
      priorJudgments: [],
    };
  }
  const parsed = parseJsonObject(raw);
  if (!parsed) return asMatterSummary({ title: fallbackTitle });
  const merged = { title: fallbackTitle, ...parsed };
  return asMatterSummary(merged);
}

// ---- review distillation ---------------------------------------------------

const REVIEW_SYSTEM = `You are a senior Indian advocate scoring a mock-argument practice session. The user argued for one side; the AI argued for the other. Score ONLY the user's turns. Return STRICT JSON — no prose, no markdown, no fences.

EVERY numeric value in the JSON below MUST be a bare JSON number — not a string, not a fraction like "4/5", not a phrase like "4 out of 5". Examples of CORRECT output: 4, 3.5, 58. Examples of WRONG output that will be rejected: "4", "4/5", "4 out of 5", "★★★★".

The "rubric" key is REQUIRED. Every dimension under "rubric" is REQUIRED. Do not omit any of them. Do not nest them under a different parent key.

Output exactly this shape:

{
  "rubric": {
    "legalSoundness":  <integer 0-5>,
    "citationUse":     <integer 0-5>,
    "structure":       <integer 0-5>,
    "persuasiveness":  <integer 0-5>,
    "responsiveness":  <integer 0-5>,
    "overall":         <integer 0-100>
  },
  "perTurn": [                                  // one entry per USER turn, ordered as they appear
    {
      "turnNumber":     <1-indexed position among USER turns, NOT the overall turn number>,
      "legalSoundness": <integer 0-5>,
      "citationUse":    <integer 0-5>,
      "structure":      <integer 0-5>,
      "persuasiveness": <integer 0-5>,
      "responsiveness": <integer 0-5>,
      "comment":        "<one sentence, ≤140 chars>"
    }
  ],
  "strengths":   ["...", "...", "..."],         // exactly 3
  "weaknesses":  ["...", "...", "..."],         // exactly 3
  "missedArguments": [                          // 2–4 items
    { "point": "...", "statute": "BNS s.X" | null, "judgment": "<name>" | null, "why": "..." }
  ],
  "studyList": [                                // 3–5 items
    { "title": "<statute or judgment name>", "citation": "...", "why": "..." }
  ],
  "improvements": [                             // 2-4 items, focus on the WEAKEST user turns
    {
      "turnNumber":     <1-indexed position among USER turns>,
      "weakDimensions": [<one or more of "legalSoundness"|"citationUse"|"structure"|"persuasiveness"|"responsiveness">],
      "currentExcerpt": "<quote (or close paraphrase) of the weakest part of what the user actually said, ≤140 chars>",
      "betterVersion":  "<the rewritten line(s) in the advocate's first-person voice, properly cited, ≤350 chars>",
      "rationale":      "<one short sentence: why this rewrite scores higher>",
      "projectedLift":  <integer 1-15, estimated overall-score points the rewrite would add on the 100 scale>
    }
  ],
  "qualitativeSummary": "<2-3 sentence narrative>"
}

The "improvements" array is the most actionable part of the review — it tells the advocate concretely how to argue better next time. Always include at least 2 items. Each currentExcerpt must come from the user's transcript, not be invented. Each betterVersion must read like something the user could actually say in court (no markdown, no lists).

Rubric calibration:
  5 = excellent / Supreme-Court-grade. 4 = strong. 3 = adequate. 2 = weak. 1 = poor. 0 = absent.
"overall" is a weighted aggregate on a 100-point scale, typically the dimension average × 20.`;

interface DistilReviewInput {
  matterSummary: MaMatterSummary;
  role: MaRole;
  /** BCP-47 language. All free-text fields in the review (strengths,
   *  weaknesses, qualitativeSummary, improvements.*) are produced in this
   *  language; rubric numbers and JSON keys stay canonical. */
  languageCode: string;
  turns: Array<{ speaker: MaSpeaker; transcript: string }>;
}

interface DistilledReview {
  review: MaReview;
  /** Per-user-turn ratings, keyed by 1-indexed user-turn position (matches the
   *  `turnNumber` field in the LLM's perTurn array). Empty when the model
   *  omitted the perTurn block. */
  perTurnByUserPosition: Map<number, MaTurnRating>;
  /** Raw text the LLM returned. Persisted on the review row for diagnostic
   *  surfacing in the UI. Null when the demo path produced this review. */
  llmRawResponse: string | null;
}

function coerceScore(v: unknown, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, n));
}

function coercePerTurnArray(raw: unknown): Map<number, MaTurnRating> {
  const out = new Map<number, MaTurnRating>();
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const n = typeof e.turnNumber === 'number' ? e.turnNumber : Number(e.turnNumber);
    if (!Number.isFinite(n) || n < 1) continue;
    out.set(Math.trunc(n), {
      legalSoundness: coerceScore(e.legalSoundness, 5),
      citationUse:    coerceScore(e.citationUse, 5),
      structure:      coerceScore(e.structure, 5),
      persuasiveness: coerceScore(e.persuasiveness, 5),
      responsiveness: coerceScore(e.responsiveness, 5),
      comment:        typeof e.comment === 'string' ? e.comment.slice(0, 200) : '',
    });
  }
  return out;
}

async function distilReview(input: DistilReviewInput, usageCtx?: MaCtx): Promise<DistilledReview | null> {
  const transcript = input.turns
    .map((t) => `${t.speaker === 'user' ? `Advocate (${input.role})` : `Opposing`}: ${t.transcript}`)
    .join('\n\n');
  const user = `Matter summary:\n${renderMatterSummary(input.matterSummary)}

The advocate was the ${input.role}. Here is the full transcript:

${transcript}

Score the advocate's performance per the system instructions.`;
  const system = REVIEW_SYSTEM + languageDirective(input.languageCode);
  const raw = await callJson({ system, user }, 2048, usageSink(usageCtx)).catch((err) => {
    logger.warn({ err }, 'mock-args review LLM failed');
    return null;
  });
  if (!raw) return null;
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;

  // Normalise the rubric BEFORE building the synthetic row, so the value
  // we persist (rubric_jsonb) is already canonical. coerceRubric reads
  // from both `parsed.rubric` and `parsed` itself in case the model
  // flattened the dimensions to the top level.
  let rubric = coerceRubric(parsed);
  const perTurnByUserPosition = coercePerTurnArray(parsed.perTurn);

  // Last-chance fallback: if the top-level rubric came out empty but the
  // model DID provide per-turn ratings, aggregate those. Better than a
  // zero-score donut when the per-turn data is right there.
  const isAllZero = (rb: MaReview['rubric']): boolean =>
    rb.legalSoundness === 0 && rb.citationUse === 0 && rb.structure === 0
    && rb.persuasiveness === 0 && rb.responsiveness === 0;
  if (isAllZero(rubric)) {
    const aggregated = aggregateFromPerTurn(perTurnByUserPosition);
    if (aggregated) rubric = aggregated;
  }

  // Diagnostic: if EVERY signal failed and we're about to persist zeros,
  // log a snippet of the raw LLM response so an operator can see the
  // actual shape the model chose and either tighten the prompt further
  // or extend coerceRubric to cover it. Logged at warn so it lights up
  // in production logs.
  if (isAllZero(rubric)) {
    logger.warn(
      {
        rawHead: raw.slice(0, 600),
        topLevelKeys: Object.keys(parsed),
        rubricKeys: parsed.rubric && typeof parsed.rubric === 'object'
          ? Object.keys(parsed.rubric as Record<string, unknown>)
          : null,
        perTurnSize: perTurnByUserPosition.size,
      },
      'mock-args review LLM returned no usable rubric — persisting zeros',
    );
  }

  // Build a synthetic ReviewRow then reuse rowToReview for the rest of
  // the field coercion. We pass the already-canonical rubric so the
  // double-coerce on read is a no-op.
  const synthetic: ReviewRow = {
    id: '00000000-0000-0000-0000-000000000000',
    session_id: '00000000-0000-0000-0000-000000000000',
    rubric_jsonb: rubric,
    strengths: Array.isArray(parsed.strengths)
      ? (parsed.strengths as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 5)
      : [],
    weaknesses: Array.isArray(parsed.weaknesses)
      ? (parsed.weaknesses as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 5)
      : [],
    missed_arguments_jsonb: Array.isArray(parsed.missedArguments) ? parsed.missedArguments : [],
    study_list_jsonb: Array.isArray(parsed.studyList) ? parsed.studyList : [],
    improvements_jsonb: coerceImprovements(parsed.improvements),
    qualitative_summary: typeof parsed.qualitativeSummary === 'string' ? parsed.qualitativeSummary : '',
    generated_at: new Date(),
    llm_raw_response: raw,
  };
  return {
    review: rowToReview(synthetic),
    perTurnByUserPosition,
    llmRawResponse: raw,
  };
}

/** Wrap demoReview() into the DistilledReview envelope distilReview now
 *  returns. The demo path emits no perTurn data — turns stay unrated. */
function demoDistilledReview(): DistilledReview {
  return {
    review: demoReview(),
    perTurnByUserPosition: new Map(),
    llmRawResponse: null,
  };
}

function demoReview(): MaReview {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    sessionId: '00000000-0000-0000-0000-000000000000',
    rubric: {
      legalSoundness: 3, citationUse: 2, structure: 3,
      persuasiveness: 3, responsiveness: 3, overall: 58,
    },
    strengths: [
      'Engaged with the AI opponent on each turn',
      'Maintained advocate posture (no narration breaks)',
      'Kept arguments relevant to the matter facts',
    ],
    weaknesses: [
      'No LLM provider configured — this is a placeholder review',
      'Citations not validated against the corpus',
      'Demonstration mode does not score rhetoric',
    ],
    missedArguments: [
      { point: 'Demonstration only — configure ANTHROPIC_API_KEY or XAI_API_KEY for real review' },
    ],
    studyList: [
      { title: 'Configure an LLM provider', why: 'apps/api/.env' },
    ],
    improvements: [
      {
        turnNumber: 1,
        weakDimensions: ['citationUse', 'legalSoundness'],
        currentExcerpt: '(no real session — placeholder excerpt)',
        betterVersion: '(no real session — once an LLM provider is configured, this will show a concrete rewrite of your weakest turn with a projected score lift.)',
        rationale: 'Demonstration only.',
        projectedLift: 0,
      },
    ],
    qualitativeSummary: 'Demonstration review — no LLM provider is configured, so this is canned output that shows the shape of a real review.',
    generatedAt: new Date().toISOString(),
    llmRawResponse: null,
  };
}

// ---- public surface --------------------------------------------------------

export const mockArgumentsService = {
  // -------------------------------------------------------------------------
  // Uploads
  // -------------------------------------------------------------------------
  /**
   * Persist an uploaded case file, run text extraction, distil a matter
   * summary. Returns the upload row + the distilled summary the client uses
   * to pre-fill the setup form. Failure of extraction or summary is NOT fatal
   * — the row persists with an empty summary so the user can paste it manually.
   */
  async createUpload(
    input: { fileName: string; fileMime: string; buffer: Buffer; storageKey: string },
    ctx: MaCtx,
  ): Promise<MaUpload> {
    const sql = sqlOrThrow();

    let extractedText = '';
    let extractionStatus: 'pending' | 'ok' | 'failed' = 'pending';
    let extractionError: string | null = null;
    try {
      const result = await extractText({
        body: input.buffer,
        mime: input.fileMime,
        fileName: input.fileName,
      });
      if (result.ok) {
        extractedText = result.text;
        extractionStatus = 'ok';
      } else {
        extractionStatus = 'failed';
        extractionError = result.error;
      }
    } catch (err) {
      extractionStatus = 'failed';
      extractionError = err instanceof Error ? err.message : 'Extraction failed';
    }

    const fallbackTitle = input.fileName.replace(/\.[^.]+$/, '').slice(0, 80);
    const summary = extractionStatus === 'ok'
      ? await distilSummary(extractedText, fallbackTitle, ctx)
      : asMatterSummary({ title: fallbackTitle });

    const rows = await sql<Array<{
      id: string;
      created_at: string | Date;
    }>>`
      insert into mock_argument_uploads (
        firm_id, uploader_user_id,
        storage_key, file_name, file_mime, file_size,
        body, extraction_status, extraction_error
      ) values (
        ${ctx.firmId}::uuid, ${ctx.userId}::uuid,
        ${input.storageKey}, ${input.fileName}, ${input.fileMime}, ${input.buffer.length},
        ${extractedText}, ${extractionStatus}::mock_argument_upload_status, ${extractionError}
      )
      returning id, created_at
    `;
    const row = rows[0]!;
    return {
      id: row.id,
      fileName: input.fileName,
      fileMime: input.fileMime,
      fileSize: input.buffer.length,
      extractionStatus,
      extractionError,
      createdAt: isoReq(row.created_at),
      summary,
    };
  },

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /**
   * Synthesise a matter summary from a saved `cases` row. Used at session
   * creation when the user picks an existing case rather than uploading.
   * Pulls only the columns that exist on `cases` today; richer context will
   * land when case_notes integration arrives in a later slice.
   */
  async summaryFromCase(caseId: string, ctx: MaCtx): Promise<MaMatterSummary> {
    const sql = sqlOrThrow();
    const rows = await sql<Array<{
      title: string; court: string; client: string; type: string; stage: string;
    }>>`
      select title, court, client, type, stage
      from cases
      where id = ${caseId}::uuid and firm_id = ${ctx.firmId}::uuid
      limit 1
    `;
    const c = rows[0];
    if (!c) throw new NotFoundError('Case not found');
    // `cases` is intentionally lean (no facts/issues columns); we seed the
    // structured summary with what we have and let the user edit it on the
    // setup screen before starting.
    return {
      title: c.title,
      court: c.court,
      parties: { petitioner: c.client, respondent: null },
      facts: [],
      issues: [],
      applicableStatutes: [],
      priorJudgments: [c.type, c.stage].filter(Boolean),
    };
  },

  async createSession(
    input: {
      caseId?: string;
      uploadId?: string;
      matterSummary: MaMatterSummary;
      role: MaRole;
      judgePersona: MaJudgePersona;
      plannedDurationSeconds?: number | null;
      inputMode: MaInputMode;
      /** BCP-47 code. Optional in the API contract — when omitted we fall
       *  back to the user's stored default_language_code, and ultimately to
       *  'en-IN' if neither is set. */
      languageCode?: string;
    },
    ctx: MaCtx,
  ): Promise<MaSession> {
    if (!input.caseId && !input.uploadId) {
      throw new UnprocessableEntityError('caseId or uploadId is required');
    }
    if (input.caseId && input.uploadId) {
      throw new UnprocessableEntityError('caseId and uploadId are mutually exclusive');
    }
    if (input.caseId && !(await caseBelongsToFirm(input.caseId, ctx.firmId))) {
      throw new NotFoundError('Case not found');
    }
    if (input.uploadId && !(await uploadBelongsToFirm(input.uploadId, ctx.firmId))) {
      throw new NotFoundError('Upload not found');
    }

    const sql = sqlOrThrow();
    // Resolve languageCode: explicit input wins; otherwise inherit the
    // user's stored default; finally fall back to English. Unknown codes
    // are rejected up-front so we never persist garbage that the picker
    // can't display later.
    const requested = input.languageCode?.trim();
    let resolvedLanguage: string;
    if (requested) {
      if (!isKnownLanguageCode(requested)) {
        throw new UnprocessableEntityError(`Unknown languageCode: ${requested}`);
      }
      resolvedLanguage = requested;
    } else {
      const defaultRows = await sql<Array<{ default_language_code: string | null }>>`
        select default_language_code from users where id = ${ctx.userId}::uuid limit 1
      `;
      resolvedLanguage = defaultRows[0]?.default_language_code || 'en-IN';
    }
    const rows = await sql<SessionRow[]>`
      insert into mock_argument_sessions (
        firm_id, user_id, case_id, upload_id,
        matter_summary_jsonb, role, judge_persona,
        planned_duration_seconds, input_mode, language_code, status
      ) values (
        ${ctx.firmId}::uuid, ${ctx.userId}::uuid,
        ${input.caseId ?? null}, ${input.uploadId ?? null},
        ${JSON.stringify(input.matterSummary)}::jsonb,
        ${input.role}::mock_argument_role,
        ${input.judgePersona}::mock_argument_judge_persona,
        ${input.plannedDurationSeconds ?? null},
        ${input.inputMode}::mock_argument_input_mode,
        ${resolvedLanguage},
        'active'::mock_argument_session_status
      )
      returning *
    `;
    return rowToSession(rows[0]!);
  },

  async listSessions(ctx: MaCtx): Promise<MaSessionSummary[]> {
    const sql = sqlOrThrow();
    // Join the users row in for the preparer's display name. LEFT JOIN
    // because a deleted user shouldn't take its rows off the list — the
    // session belongs to the firm too. Falls back to empty string at the
    // mapper, which the web shows as the matter title only.
    const rows = await sql<Array<SessionRow & {
      turn_count: string | number;
      prepared_by_name: string | null;
    }>>`
      select s.*,
             (select count(*) from mock_argument_turns t where t.session_id = s.id) as turn_count,
             u.name as prepared_by_name
      from mock_argument_sessions s
      left join users u on u.id = s.user_id
      where s.firm_id = ${ctx.firmId}::uuid and s.user_id = ${ctx.userId}::uuid
      order by s.started_at desc
      limit 100
    `;
    return rows.map((r) => {
      const summary = asMatterSummary(r.matter_summary_jsonb);
      return {
        id: r.id,
        caseId: r.case_id,
        uploadId: r.upload_id,
        matterTitle: summary.title || '(untitled session)',
        preparedByName: r.prepared_by_name ?? '',
        role: r.role,
        judgePersona: r.judge_persona,
        languageCode: r.language_code ?? 'en-IN',
        status: r.status,
        startedAt: isoReq(r.started_at),
        endedAt: iso(r.ended_at),
        overallScore: r.overall_score == null ? null : Number(r.overall_score),
        turnCount: Number(r.turn_count ?? 0),
      };
    });
  },

  async getSession(sessionId: string, ctx: MaCtx): Promise<MaSessionWithTurns> {
    const sql = sqlOrThrow();
    const session = rowToSession(await loadOwnedSession(sessionId, ctx));

    const turnRows = await sql<TurnRow[]>`
      select * from mock_argument_turns
      where session_id = ${sessionId}::uuid
      order by turn_number asc
    `;
    const turns = turnRows.map(rowToTurn);

    const reviewRows = await sql<ReviewRow[]>`
      select * from mock_argument_reviews
      where session_id = ${sessionId}::uuid
      limit 1
    `;
    const review = reviewRows[0] ? rowToReview(reviewRows[0]) : null;

    return { ...session, turns, review };
  },

  // -------------------------------------------------------------------------
  // Turn submission (streamed)
  // -------------------------------------------------------------------------

  /**
   * Append the user turn, retrieve relevant statute chunks, stream the AI
   * counter-argument back through the returned async iterator. Once the
   * iterator finishes, the AI turn is persisted (with its citations) and
   * the final object can be read via `await iterator.finalAiTurn` — exposed
   * here as a closed-over promise the route resolves before sending the
   * `done` SSE frame.
   */
  async beginTurn(
    sessionId: string,
    userTranscript: string,
    ctx: MaCtx,
  ): Promise<{
    userTurn: MaTurn;
    citations: MaCitation[];
    stream: AsyncGenerator<string, void, void>;
    /** Resolves with the persisted AI turn after the stream finishes. */
    finalAiTurn: Promise<MaTurn>;
  }> {
    const text = userTranscript.trim();
    if (!text) throw new UnprocessableEntityError('Empty transcript — nothing to submit');

    const sql = sqlOrThrow();
    const sessionRow = await loadOwnedSession(sessionId, ctx);
    if (sessionRow.status !== 'active') {
      throw new UnprocessableEntityError(`Cannot append a turn to a ${sessionRow.status} session`);
    }
    const session = rowToSession(sessionRow);

    // Insert the user turn under a server-side computed turn_number to avoid
    // the read-then-write race a JS-side computation would have. Wrapping
    // both the read and the insert in a transaction would also work, but the
    // subquery is simpler.
    const userTurnRows = await sql<TurnRow[]>`
      insert into mock_argument_turns (session_id, turn_number, speaker, transcript)
      select ${sessionId}::uuid,
             coalesce(max(turn_number), 0) + 1,
             'user'::mock_argument_speaker,
             ${text}
      from mock_argument_turns
      where session_id = ${sessionId}::uuid
      returning *
    `;
    const userTurn = rowToTurn(userTurnRows[0]!);

    // Pull every turn after the rolling-summary checkpoint, excluding the
    // freshly-inserted user turn (the AI replies to that one separately).
    // The verbatim window is unbounded between regens but bounded in practice
    // by REGEN_TRIGGER — see the rolling-summary section above.
    const recentRows = await sql<TurnRow[]>`
      select * from mock_argument_turns
      where session_id = ${sessionId}::uuid
        and turn_number > ${session.lastSummarizedTurn}
        and turn_number <  ${userTurn.turnNumber}
      order by turn_number asc
    `;
    const recentTurns = recentRows.map(rowToTurn);

    // RAG retrieval. lawsSearchService gracefully no-ops when the laws DB
    // isn't configured, so we wrap it in a try/catch and continue with an
    // empty citation set rather than failing the turn.
    let retrieved: LawHit[] = [];
    if (lawsSearchService.configured()) {
      try {
        const ragQuery = `${session.matterSummary.title} ${text}`.slice(0, 800);
        retrieved = await lawsSearchService.search(ragQuery, { k: 6, rerank: true });
      } catch (err) {
        logger.warn({ err }, 'mock-args RAG retrieval failed; continuing without citations');
      }
    }

    const citations = retrieved.map(projectCitation);
    const prompt = buildTurnPrompt({
      matterSummary: session.matterSummary,
      role: session.role,
      judgePersona: session.judgePersona,
      languageCode: session.languageCode,
      rollingSummary: session.rollingSummary ?? '',
      recentTurns: recentTurns.map((t) => ({ speaker: t.speaker, transcript: t.transcript })),
      currentUserTurn: text,
      retrievedLaws: retrieved,
    });

    // Wrap the actual stream so we can capture the full text as it goes
    // by, persist the AI turn once it ends, and resolve `finalAiTurn` for
    // the route layer.
    let resolveFinal!: (t: MaTurn) => void;
    let rejectFinal!: (err: unknown) => void;
    const finalAiTurn = new Promise<MaTurn>((resolve, reject) => {
      resolveFinal = resolve; rejectFinal = reject;
    });

    const persistAiTurn = async (fullText: string): Promise<MaTurn> => {
      const aiRows = await sql<TurnRow[]>`
        insert into mock_argument_turns (
          session_id, turn_number, speaker, transcript, citations_jsonb
        ) select
            ${sessionId}::uuid,
            coalesce(max(turn_number), 0) + 1,
            'ai'::mock_argument_speaker,
            ${fullText},
            ${JSON.stringify(citations)}::jsonb
          from mock_argument_turns
          where session_id = ${sessionId}::uuid
        returning *
      `;
      return rowToTurn(aiRows[0]!);
    };

    const wrappedStream = (async function* (): AsyncGenerator<string, void, void> {
      let collected = '';
      try {
        if (env.llmProvider === 'none') {
          const fallback = fallbackAiTurn({
            matterSummary: session.matterSummary,
            role: session.role,
            judgePersona: session.judgePersona,
            languageCode: session.languageCode,
            rollingSummary: session.rollingSummary ?? '',
            recentTurns: recentTurns.map((t) => ({ speaker: t.speaker, transcript: t.transcript })),
            currentUserTurn: text,
            retrievedLaws: retrieved,
          });
          collected = fallback;
          yield fallback;
        } else {
          for await (const chunk of streamTurnFromProvider(prompt, usageSink(ctx))) {
            collected += chunk;
            yield chunk;
          }
        }
        const persisted = await persistAiTurn(collected || '[no response]');
        resolveFinal(persisted);
        // Rolling-summary regen runs AFTER the AI turn is persisted so the
        // checkpoint reflects the freshly-completed exchange. Failures here
        // are non-fatal: an out-of-date summary just means the next turn's
        // prompt has more verbatim history, not that the session breaks.
        await maybeRegenerateSummary(sql, sessionId, ctx, session);
      } catch (err) {
        // Persist whatever we collected before the error so the user can see
        // the partial reply on refresh; mark with a sentinel suffix.
        try {
          const persisted = await persistAiTurn(
            (collected || '').trim()
            + `\n\n[stream interrupted: ${err instanceof Error ? err.message : 'unknown error'}]`,
          );
          resolveFinal(persisted);
        } catch (persistErr) {
          rejectFinal(persistErr);
        }
        throw err;
      }
    })();

    return { userTurn, citations, stream: wrappedStream, finalAiTurn };
  },

  // -------------------------------------------------------------------------
  // Conclude → review
  // -------------------------------------------------------------------------

  async concludeSession(sessionId: string, ctx: MaCtx): Promise<MaSessionWithTurns> {
    const sessionRow = await loadOwnedSession(sessionId, ctx);
    if (sessionRow.status === 'concluded') {
      // Idempotent for first-time-conclude — re-run is its own endpoint
      // so accidental double-clicks on Conclude don't trigger another LLM
      // bill.
      return this.getSession(sessionId, ctx);
    }
    if (sessionRow.status !== 'active') {
      throw new UnprocessableEntityError(`Cannot conclude a ${sessionRow.status} session`);
    }
    return runReviewAndPersist(sessionRow, ctx, { markConcluded: true });
  },

  /**
   * Re-generate the review for a session that has already been concluded.
   * Overwrites the existing mock_argument_reviews row in place and updates
   * the session's overall_score. Status and ended_at stay where they were
   * — re-running a review doesn't mean the session was re-opened.
   *
   * Use cases:
   *   - Recover from a prior LLM hiccup (e.g. all-zero rubric persisted
   *     before the defensive coerceRubric landed).
   *   - Re-score after the prompt template changes.
   */
  async rerunReview(sessionId: string, ctx: MaCtx): Promise<MaSessionWithTurns> {
    const sessionRow = await loadOwnedSession(sessionId, ctx);
    if (sessionRow.status !== 'concluded') {
      throw new UnprocessableEntityError(
        `Can only re-run review on a concluded session (got ${sessionRow.status}). Conclude it first.`,
      );
    }
    return runReviewAndPersist(sessionRow, ctx, { markConcluded: false });
  },
};

// =============================================================================
// Shared review-generation pipeline used by both concludeSession and
// rerunReview. Keeping it at module scope rather than as a method on the
// service avoids the `this`-binding gymnastics that arise when calling
// `this._helper(...)` from the public methods above.
// =============================================================================

async function runReviewAndPersist(
  sessionRow: SessionRow,
  ctx: MaCtx,
  opts: { markConcluded: boolean },
): Promise<MaSessionWithTurns> {
  const sql = sqlOrThrow();
  const sessionId = sessionRow.id;
  const session = rowToSession(sessionRow);

  const allTurnsRows = await sql<TurnRow[]>`
    select * from mock_argument_turns
    where session_id = ${sessionId}::uuid
    order by turn_number asc
  `;
  const allTurns = allTurnsRows.map(rowToTurn);

  const distilled = env.llmProvider === 'none'
    ? demoDistilledReview()
    : (await distilReview({
        matterSummary: session.matterSummary,
        role: session.role,
        languageCode: session.languageCode,
        turns: allTurns.map((t) => ({ speaker: t.speaker, transcript: t.transcript })),
      }, ctx)) ?? demoDistilledReview();
  const { review, perTurnByUserPosition, llmRawResponse } = distilled;

  // Map LLM's 1-indexed per-USER-turn positions to actual DB turn numbers.
  const userTurns = allTurns.filter((t) => t.speaker === 'user');
  const ratingByDbTurnNumber = new Map<number, MaTurnRating>();
  for (let i = 0; i < userTurns.length; i++) {
    const rating = perTurnByUserPosition.get(i + 1);
    if (rating) ratingByDbTurnNumber.set(userTurns[i]!.turnNumber, rating);
  }

  await sql.begin(async (tx) => {
    await tx`
      insert into mock_argument_reviews (
        session_id, rubric_jsonb, strengths, weaknesses,
        missed_arguments_jsonb, study_list_jsonb, improvements_jsonb,
        qualitative_summary, llm_raw_response
      ) values (
        ${sessionId}::uuid,
        ${JSON.stringify(review.rubric)}::jsonb,
        ${review.strengths}::text[],
        ${review.weaknesses}::text[],
        ${JSON.stringify(review.missedArguments)}::jsonb,
        ${JSON.stringify(review.studyList)}::jsonb,
        ${JSON.stringify(review.improvements)}::jsonb,
        ${review.qualitativeSummary},
        ${llmRawResponse}
      )
      on conflict (session_id) do update set
        rubric_jsonb = excluded.rubric_jsonb,
        strengths = excluded.strengths,
        weaknesses = excluded.weaknesses,
        missed_arguments_jsonb = excluded.missed_arguments_jsonb,
        study_list_jsonb = excluded.study_list_jsonb,
        improvements_jsonb = excluded.improvements_jsonb,
        qualitative_summary = excluded.qualitative_summary,
        llm_raw_response = excluded.llm_raw_response,
        generated_at = now()
    `;
    // Per-turn ratings: one UPDATE per scored user turn. Bounded by user
    // turn count (typically ≤ 20) so the fan-out is cheap.
    //
    // Note: turns that did NOT get a rating from the LLM keep whatever
    // they had previously. We don't NULL them out on re-run — that would
    // wipe valid scores any time the model omits an entry.
    for (const [turnNumber, rating] of ratingByDbTurnNumber) {
      await tx`
        update mock_argument_turns set rating_jsonb = ${JSON.stringify(rating)}::jsonb
        where session_id = ${sessionId}::uuid and turn_number = ${turnNumber}
      `;
    }
    if (opts.markConcluded) {
      // First-time conclude: flip status + ended_at + cache the score.
      await tx`
        update mock_argument_sessions set
          status = 'concluded'::mock_argument_session_status,
          ended_at = now(),
          overall_score = ${review.rubric.overall}
        where id = ${sessionId}::uuid
          and firm_id = ${ctx.firmId}::uuid
          and user_id = ${ctx.userId}::uuid
      `;
    } else {
      // Re-run: only refresh the cached overall_score; preserve status +
      // original ended_at so the session metadata still reflects the
      // original conclude time.
      await tx`
        update mock_argument_sessions set
          overall_score = ${review.rubric.overall}
        where id = ${sessionId}::uuid
          and firm_id = ${ctx.firmId}::uuid
          and user_id = ${ctx.userId}::uuid
      `;
    }
  });

  return mockArgumentsService.getSession(sessionId, ctx);
}
