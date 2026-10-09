import type { DraftRequest, DraftResponse } from '@lexdraft/types';
import { env } from '../env';
import { logger } from '../logger';
import { withRetry } from '../lib/retry';
import { type NormalizedUsage } from '../lib/llm-usage';
import { claudeComplete, claudeStream } from '../lib/anthropic-client';
import { grokComplete, grokStream } from '../lib/grok-client';

const SAMPLE_TEMPLATE = (req: DraftRequest): string => {
  const lines: string[] = [];
  lines.push(req.docType.toUpperCase());
  lines.push('');
  const dated = req.draftDate ?? new Date().toISOString().slice(0, 10);
  lines.push(`Dated: ${dated}`);
  lines.push(`Drafted in ${req.language === 'EN' ? 'English' : req.language === 'HI' ? 'Hindi' : 'Tamil'} · Tone: ${req.tone}`);
  lines.push('');
  for (const [k, v] of Object.entries(req.fields)) {
    if (!v) continue;
    lines.push(`${k.replace(/_/g, ' ')}: ${v}`);
  }
  lines.push('');
  lines.push(
    `This document is generated as a working draft for advocate review. It follows Indian procedural conventions for ${req.docType} and is to be revised before filing or service. All facts and citations should be verified against the case record.`,
  );
  lines.push('');
  lines.push('Yours faithfully,');
  lines.push('Counsel for the Petitioner');
  return lines.join('\n');
};

export interface BuiltPrompt {
  system: string;
  user: string;
}

/** Case-note context folded into the user message. Title is shown as a
 *  human-readable label; body is the typed text or PDF/DOCX extraction
 *  output produced by case-notes.service. */
export interface NoteContextItem {
  id: string;
  title: string;
  body: string;
}

/** Authoritative facts pulled straight from the case record (not advocate
 *  free-text). These are the identity of the matter — court, CNR, stage, and,
 *  for criminal matters, the FIR particulars — that a draft for THIS case must
 *  reference verbatim rather than leave as a placeholder. Every field is
 *  optional because a freshly-created matter may carry only a few of them. */
export interface CaseFacts {
  title?: string;
  court?: string;
  cnr?: string;
  stage?: string;
  caseType?: string;
  client?: string;
  /** FIR particulars — the load-bearing fields for criminal drafting. */
  firNo?: string;
  firYear?: number;
  policeStation?: string;
  firDetails?: string;
  /** Next listed date, where relevant to the relief/urgency. */
  nextHearing?: string;
}

/** Render the case record as an AUTHORITATIVE facts block. Marked distinctly
 *  from advocate-supplied notes so the model treats these as the ground truth
 *  of the matter (the court, the CNR, the FIR) rather than a guess to confirm. */
export function renderCaseFactsBlock(facts: CaseFacts | null | undefined): string {
  if (!facts) return '';
  const rows: Array<[string, string | number | undefined]> = [
    ['Matter title', facts.title],
    ['Court / jurisdiction', facts.court],
    ['CNR / case number', facts.cnr],
    ['Stage of proceedings', facts.stage],
    ['Case type', facts.caseType],
    ['Client', facts.client],
    ['FIR number', facts.firNo],
    ['FIR year', facts.firYear],
    ['Police station (code)', facts.policeStation],
    ['FIR details', facts.firDetails],
    ['Next hearing', facts.nextHearing],
  ];
  const lines = rows
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `- ${k}: ${v}`);
  if (lines.length === 0) return '';
  return `\n\n# Case record (AUTHORITATIVE — use these facts verbatim; do not contradict or re-guess them)\n${lines.join(
    '\n',
  )}`;
}

/** Trim a single note body so the combined context stays within a sane
 *  token budget. Per-note cap keeps one giant note from crowding everything
 *  else out; the corpus cap (in buildPrompt) is the global limit. */
const PER_NOTE_CHAR_CAP = 8_000;
const ALL_NOTES_CHAR_CAP = 24_000;

function clipNoteBody(body: string): string {
  if (body.length <= PER_NOTE_CHAR_CAP) return body;
  return `${body.slice(0, PER_NOTE_CHAR_CAP)}\n[... truncated for prompt budget]`;
}

export function renderNotesBlock(notes: NoteContextItem[]): string {
  if (notes.length === 0) return '';
  let total = 0;
  const sections: string[] = [];
  for (const n of notes) {
    const clipped = clipNoteBody(n.body.trim());
    if (total + clipped.length > ALL_NOTES_CHAR_CAP) {
      sections.push(`\n[remaining ${notes.length - sections.length} notes omitted - prompt budget reached]`);
      break;
    }
    total += clipped.length;
    sections.push(`## ${n.title}\n${clipped}`);
  }
  return `\n\n# Case notes (advocate-supplied background)\n${sections.join('\n\n')}`;
}

/** Split into system + user so Anthropic's top-level `system` param and xAI's
 *  `{role:'system'}` message both carry the persona/style instructions, while
 *  the user message carries only the request-specific task and brief. Same
 *  split is applied to both providers - A/B remains apples-to-apples. */
export function languageName(language: DraftRequest['language']): string {
  return language === 'EN' ? 'English' : language === 'HI' ? 'Hindi' : 'Tamil';
}

/** Render the filled brief fields as a bullet list, dropping blanks. Shared by
 *  the single-shot prompt and the agent so both see the brief identically. */
export function renderBriefLines(fields: DraftRequest['fields']): string {
  return Object.entries(fields)
    .filter(([, v]) => v && v.toString().trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
}

function buildPrompt(
  req: DraftRequest,
  notes: NoteContextItem[] = [],
  facts: CaseFacts | null = null,
): BuiltPrompt {
  const langName = languageName(req.language);
  const briefLines = renderBriefLines(req.fields);
  const dated = req.draftDate ?? new Date().toISOString().slice(0, 10);

  const system = `You are an experienced Indian advocate. Draft court-ready documents in ${langName} following Indian legal conventions, statutes, and pleading style. Number paragraphs where appropriate. Include proper headings, parties block, prayer/conclusion, and verification/jurat where applicable. Be precise and concise - under 500 words. Output ONLY the document text - no commentary, no markdown.${notes.length > 0 ? ' Use the case notes only when they directly inform a fact or pleading; do not pad the draft with unrelated context.' : ''}`;

  const user = `Draft a "${req.docType}" with tone: ${req.tone}. Date the document "${dated}".
${renderCaseFactsBlock(facts)}
# Brief
${briefLines}${renderNotesBlock(notes)}`;

  return { system, user };
}

type ProviderOverride = 'xai' | 'anthropic' | undefined;

/** Token usage surfaced to the caller after a successful provider call, so the
 *  route (which knows firmId/userId) can record it. Best-effort - callers must
 *  never let an onUsage handler throw into the generation path. */
export interface LlmUsage extends NormalizedUsage {
  provider: 'anthropic' | 'xai';
  model: string;
}

export interface GenerateOpts {
  provider?: ProviderOverride;
  /** Optional case-notes context. Caller resolves access rules before
   *  passing them in - the drafting service trusts whatever it receives. */
  notes?: NoteContextItem[];
  /** Optional authoritative case-record facts (court, CNR, FIR, ...). Resolved
   *  and access-checked by the caller; the service just folds them into the
   *  prompt as ground truth. */
  facts?: CaseFacts | null;
  /** Invoked once when the provider returns token usage. */
  onUsage?: (usage: LlmUsage) => void;
}

/** Resolve which provider to actually call for this request. An explicit
 *  override beats the env default; if the override picks a provider whose
 *  key is missing, we fall back to env.llmProvider rather than crashing. */
function resolveProvider(override: ProviderOverride): 'xai' | 'anthropic' | 'none' {
  if (override === 'xai' && env.XAI_API_KEY) return 'xai';
  if (override === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  return env.llmProvider;
}

export const draftingService = {
  async generate(req: DraftRequest, opts: GenerateOpts = {}): Promise<DraftResponse> {
    let text: string;
    const provider = resolveProvider(opts.provider);
    const notes = opts.notes ?? [];
    const facts = opts.facts ?? null;
    if (provider === 'xai') {
      try {
        const r = await callGrok(req, notes, facts);
        text = r.text;
        opts.onUsage?.({ provider: 'xai', model: env.XAI_MODEL, ...r.usage });
      } catch (err) {
        logger.warn({ err }, 'Grok call failed, falling back to template');
        text = SAMPLE_TEMPLATE(req);
      }
    } else if (provider === 'anthropic') {
      try {
        const r = await callClaude(req, notes, facts);
        text = r.text;
        opts.onUsage?.({ provider: 'anthropic', model: env.ANTHROPIC_MODEL, ...r.usage });
      } catch (err) {
        logger.warn({ err }, 'Claude call failed, falling back to template');
        text = SAMPLE_TEMPLATE(req);
      }
    } else {
      text = SAMPLE_TEMPLATE(req);
    }
    return { docType: req.docType, text, generatedAt: new Date().toISOString() };
  },

  /**
   * Streams text chunks for the brief. The caller receives each delta as it
   * arrives from the provider. If no key is set, the deterministic template
   * is yielded as a single chunk so the UI behaves the same in dev.
   */
  async *generateStream(
    req: DraftRequest,
    opts: GenerateOpts = {},
  ): AsyncGenerator<string, void, void> {
    const provider = resolveProvider(opts.provider);
    const notes = opts.notes ?? [];
    const facts = opts.facts ?? null;
    if (provider === 'none') {
      yield SAMPLE_TEMPLATE(req);
      return;
    }
    try {
      if (provider === 'xai') {
        yield* streamGrok(req, notes, opts.onUsage, facts);
      } else {
        yield* streamClaude(req, notes, opts.onUsage, facts);
      }
    } catch (err) {
      logger.warn({ err, provider }, 'LLM stream failed, falling back to template');
      yield SAMPLE_TEMPLATE(req);
    }
  },
};

interface ProviderResult {
  text: string;
  usage: NormalizedUsage;
}

// ---- Low-level provider primitives -----------------------------------------
// These take an already-built { system, user } prompt so any caller (e.g. the
// drafting agent's plan/review stages) can reuse the exact same request shape,
// retry policy, and usage normalisation as the single-shot path above.

/** Which provider a raw prompt should be sent to. Mirrors resolveProvider but
 *  is exposed so the agent can decide once and reuse for every stage. */
export function resolveActiveProvider(override: ProviderOverride): 'xai' | 'anthropic' | 'none' {
  return resolveProvider(override);
}

/** One non-streaming completion for an arbitrary prompt. Used by the agent's
 *  plan and review stages, which want the full text at once, not deltas. */
export async function runPrompt(
  prompt: BuiltPrompt,
  provider: 'xai' | 'anthropic',
  maxTokens = 1024,
): Promise<ProviderResult> {
  return provider === 'anthropic'
    ? callClaudeRaw(prompt, maxTokens)
    : callGrokRaw(prompt, maxTokens);
}

/** Streaming completion for an arbitrary prompt. Used by the agent's final
 *  draft/refine stage so the document still streams token-by-token to the UI. */
export async function* streamPrompt(
  prompt: BuiltPrompt,
  provider: 'xai' | 'anthropic',
  onUsage?: (usage: LlmUsage) => void,
  maxTokens = 2048,
): AsyncGenerator<string, void, void> {
  if (provider === 'anthropic') {
    yield* streamClaudeRaw(prompt, onUsage, maxTokens);
  } else {
    yield* streamGrokRaw(prompt, onUsage, maxTokens);
  }
}

async function callClaude(
  req: DraftRequest,
  notes: NoteContextItem[],
  facts: CaseFacts | null = null,
): Promise<ProviderResult> {
  return callClaudeRaw(buildPrompt(req, notes, facts));
}

async function callClaudeRaw({ system, user }: BuiltPrompt, maxTokens = 2048): Promise<ProviderResult> {
  // Prompt caching: the system block is identical across requests, so the
  // shared client marks it cache_control='ephemeral' (cacheSystem defaults to
  // true), letting Anthropic reuse the encoded prefix across calls. The savings
  // are token-count dependent (≥1024 input tokens for Sonnet to actually cache)
  // and harmless when the prompt is small. claudeComplete throws HttpRetryError
  // on API errors, so the outer withRetry still triggers on 429/5xx.
  return withRetry(
    async () => {
      const { text, ...usage } = await claudeComplete({ system, user, maxTokens });
      return { text, usage };
    },
    {
      onRetry: (err, attempt, waitMs) =>
        logger.warn({ err, attempt, waitMs }, 'Claude call retry'),
    },
  );
}

async function callGrok(
  req: DraftRequest,
  notes: NoteContextItem[],
  facts: CaseFacts | null = null,
): Promise<ProviderResult> {
  return callGrokRaw(buildPrompt(req, notes, facts));
}

async function callGrokRaw({ system, user }: BuiltPrompt, maxTokens = 2048): Promise<ProviderResult> {
  // grokComplete throws HttpRetryError on API errors, so the outer withRetry
  // still triggers on 429/5xx. It returns the same NormalizedUsage (via
  // xaiUsage) the raw-fetch path produced.
  return withRetry(
    async () => {
      const { text, ...usage } = await grokComplete({ system, user, maxTokens });
      return { text, usage };
    },
    {
      onRetry: (err, attempt, waitMs) =>
        logger.warn({ err, attempt, waitMs }, 'Grok call retry'),
    },
  );
}

async function* streamGrok(
  req: DraftRequest,
  notes: NoteContextItem[],
  onUsage?: (usage: LlmUsage) => void,
  facts: CaseFacts | null = null,
): AsyncGenerator<string, void, void> {
  yield* streamGrokRaw(buildPrompt(req, notes, facts), onUsage);
}

async function* streamGrokRaw(
  { system, user }: BuiltPrompt,
  onUsage?: (usage: LlmUsage) => void,
  maxTokens = 2048,
): AsyncGenerator<string, void, void> {
  // The shared grokStream yields text deltas in order and reports the final
  // token usage (via xaiUsage, from the include_usage terminal chunk) once the
  // stream settles — matching the former manual SSE parse.
  yield* grokStream({
    system,
    user,
    maxTokens,
    onUsage: (usage) => onUsage?.({ provider: 'xai', model: env.XAI_MODEL, ...usage }),
  });
}

async function* streamClaude(
  req: DraftRequest,
  notes: NoteContextItem[],
  onUsage?: (usage: LlmUsage) => void,
  facts: CaseFacts | null = null,
): AsyncGenerator<string, void, void> {
  yield* streamClaudeRaw(buildPrompt(req, notes, facts), onUsage);
}

async function* streamClaudeRaw(
  { system, user }: BuiltPrompt,
  onUsage?: (usage: LlmUsage) => void,
  maxTokens = 2048,
): AsyncGenerator<string, void, void> {
  // Streaming responses can't be transparently retried mid-stream (we'd
  // emit duplicate deltas), so the connection itself isn't wrapped in
  // withRetry. The non-streaming generate() path remains the resilient
  // fallback when the stream call fails outright. The shared claudeStream
  // yields text deltas in order and reports the authoritative final usage
  // (input + cache + output tokens) once the stream settles.
  yield* claudeStream({
    system,
    user,
    maxTokens,
    onUsage: (usage) => onUsage?.({ provider: 'anthropic', model: env.ANTHROPIC_MODEL, ...usage }),
  });
}
