// =============================================================================
// draft-extract.service — pull structured draft fields out of a free-form brief.
//
// The advocate dictates or types the matter; we ask the LLM to extract values
// for exactly the target document's schema fields (supplied by the client, since
// the per-doc-type schema lives in apps/web/src/lib/doc-schemas.ts). The result
// pre-fills the drafting form so the gaps can be surfaced for completion.
//
// LLM client + JSON-extraction pattern mirror diary-assistant.service.ts; the
// provider override + fallback mirror drafting.service.ts. Degrades to an empty
// extraction (the UI then falls back to manual entry) when AI is off, the brief
// is empty, or the call fails. Quota is asserted before a real call and recorded
// after.
// =============================================================================

import type {
  DraftFieldSpec,
  ExtractDraftFieldsRequest,
  ExtractDraftFieldsResponse,
} from '@lexdraft/types';
import { env } from '../env';
import { logger } from '../logger';
import { withRetry, HttpRetryError } from '../lib/retry';
import { aiQuotaService } from './ai-quota.service';
import { aiUsageService } from './ai-usage.service';
import { anthropicUsage, xaiUsage, type NormalizedUsage } from '../lib/llm-usage';

type Provider = 'xai' | 'anthropic' | 'none';

/** Provider reply plus normalised token usage. */
interface LlmResult extends NormalizedUsage {
  text: string;
}

/** Resolve which provider to call. An explicit override wins when its key is
 *  set; otherwise fall back to the env default. Mirrors drafting.service. */
function resolveProvider(override?: 'xai' | 'anthropic'): Provider {
  if (override === 'xai' && env.XAI_API_KEY) return 'xai';
  if (override === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  return env.llmProvider;
}

function providerTag(provider: Provider): string {
  if (provider === 'anthropic') return `anthropic:${env.ANTHROPIC_MODEL}`;
  if (provider === 'xai') return `xai:${env.XAI_MODEL}`;
  return 'fallback:none';
}

function recordQuota(firmId: string | null, userId: string, provider: Provider, docType: string): void {
  void aiQuotaService
    .record(firmId, userId, 'generate', { provider, docType })
    .catch((err) => logger.warn({ err, docType }, 'draft-extract: ai-quota record failed'));
}

// ---- LLM client (mirrors diary-assistant.service.ts) -----------------------

async function complete(provider: Provider, system: string, user: string, maxTokens: number): Promise<LlmResult> {
  if (provider === 'anthropic') return callClaude(system, user, maxTokens);
  if (provider === 'xai') return callGrok(system, user, maxTokens);
  throw new Error('LLM disabled');
}

async function callClaude(system: string, user: string, maxTokens: number): Promise<LlmResult> {
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
          max_tokens: maxTokens,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: user }],
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
    { onRetry: (err, attempt, waitMs) => logger.warn({ err, attempt, waitMs }, 'draft-extract Claude retry') },
  );
}

async function callGrok(system: string, user: string, maxTokens: number): Promise<LlmResult> {
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
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
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
    { onRetry: (err, attempt, waitMs) => logger.warn({ err, attempt, waitMs }, 'draft-extract Grok retry') },
  );
}

/** Pull a JSON object out of an LLM reply that may be wrapped in prose or a
 *  ```json fence. Returns null when nothing parses. */
function parseJsonLoose<T>(raw: string): T | null {
  if (!raw) return null;
  const fenced = raw.replace(/```(?:json)?/gi, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

// ---- prompt + coercion -----------------------------------------------------

const MAX_BRIEF_CHARS = 12_000;
const MAX_FIELDS = 120;

function buildExtractPrompt(req: ExtractDraftFieldsRequest): { system: string; user: string } {
  const system = `You extract structured fields for an Indian legal document ("${req.docType}") from the advocate's free-form brief.

Output ONLY a JSON object mapping field keys to extracted string values — no prose, no markdown fence.

Rules:
- Include a key ONLY if the brief clearly provides that information. OMIT keys you cannot fill — do not guess, do not output empty strings.
- Never invent facts, names, dates, amounts, or citations not present in the brief.
- For a "select" field, output EXACTLY one of its allowed options (verbatim).
- For a "date" field, output YYYY-MM-DD.
- For "currency"/"number" fields, output digits only (no symbols, commas, or words).
- For "text"/"textarea" fields, output the relevant content from the brief, lightly cleaned up.`;

  const fieldLines = req.fields
    .map((f) => {
      const opts = f.type === 'select' && f.options?.length ? `; one of: ${f.options.join(' | ')}` : '';
      const req_ = f.required ? '; required' : '';
      return `- ${f.key} — ${f.label} [${f.type}${opts}${req_}]`;
    })
    .join('\n');

  const user = `# Fields to extract\n${fieldLines}\n\n# Advocate's brief\n${req.brief.slice(0, MAX_BRIEF_CHARS)}`;
  return { system, user };
}

/** Coerce a raw extracted value to the field's type. Returns '' to signal the
 *  value should be dropped (invalid / empty). */
function coerceValue(spec: DraftFieldSpec, raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';

  switch (spec.type) {
    case 'select': {
      if (!spec.options?.length) return s;
      const match = spec.options.find((o) => o.toLowerCase() === s.toLowerCase());
      return match ?? '';
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
    case 'currency':
    case 'number': {
      const digits = s.replace(/[^0-9.]/g, '');
      // collapse to at most one decimal point
      const cleaned = digits.replace(/(\..*)\./g, '$1');
      return cleaned.replace(/\.$/, '');
    }
    default:
      return s;
  }
}

export const draftExtractService = {
  /**
   * Extract field values from the brief. Never throws on LLM/parse failure —
   * returns an empty extraction so the UI degrades to manual entry. May throw
   * AiQuotaExceededError (the route maps it to 429) when a real call is gated.
   */
  async extractFields(
    req: ExtractDraftFieldsRequest,
    ctx: { firmId: string | null; userId: string },
  ): Promise<ExtractDraftFieldsResponse> {
    const provider = resolveProvider(req.provider);
    const fields = req.fields.slice(0, MAX_FIELDS);

    if (provider === 'none' || !req.brief.trim() || fields.length === 0 || !ctx.userId || !ctx.firmId) {
      return { values: {}, modelUsed: 'fallback:none' };
    }

    // Real call — guard quota (may throw -> route 429), then extract.
    await aiQuotaService.assertCanGenerate(ctx.firmId, ctx.userId);

    let raw: string;
    try {
      const { system, user } = buildExtractPrompt({ ...req, fields });
      const result = await complete(provider, system, user, 1500);
      raw = result.text;
      aiUsageService.recordAsync({
        firmId: ctx.firmId, userId: ctx.userId, feature: 'draft_extract',
        provider, model: provider === 'anthropic' ? env.ANTHROPIC_MODEL : env.XAI_MODEL,
        tokensIn: result.tokensIn, tokensOut: result.tokensOut,
        cacheReadTokens: result.cacheRead, cacheWriteTokens: result.cacheWrite,
      });
    } catch (err) {
      logger.warn({ err }, 'draft-extract LLM call failed; returning empty extraction');
      return { values: {}, modelUsed: 'fallback:error' };
    }

    const obj = parseJsonLoose<Record<string, unknown>>(raw);
    if (!obj) {
      logger.warn({ raw: raw.slice(0, 200) }, 'draft-extract: unparseable JSON');
      return { values: {}, modelUsed: 'fallback:error' };
    }

    const allowed = new Map(fields.map((f) => [f.key, f]));
    const values: Record<string, string> = {};
    for (const [key, rawVal] of Object.entries(obj)) {
      const spec = allowed.get(key);
      if (!spec) continue; // drop hallucinated keys not in the schema
      const v = coerceValue(spec, rawVal);
      if (v) values[key] = v;
    }

    recordQuota(ctx.firmId, ctx.userId, provider, 'draft-extract');
    return { values, modelUsed: providerTag(provider) };
  },
};
