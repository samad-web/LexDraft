// =============================================================================
// anthropic-client — the single official-SDK Anthropic client for the whole API.
//
// Every service that used to hand-roll `fetch('https://api.anthropic.com/v1/
// messages')` now goes through here. Benefits: one place for the client, auth,
// prompt-cache defaults, error→retry shaping, and usage mapping — so behaviour
// (including the token accounting the billing/quota code reads) is identical
// across all ~14 former call sites.
//
// Auth: one server-side org key (ANTHROPIC_API_KEY). Multi-tenant isolation is
// the firm/RBAC/quota layer, NOT per-tenant keys — the SDK is a client library
// and still authenticates with a credential; there is no keyless server mode.
//
// maxRetries:0 on the SDK because callers wrap us in their own withRetry (or
// tolerate transport errors); we don't want the SDK retrying underneath them.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env';
import { HttpRetryError } from './retry';
import { anthropicUsage, type NormalizedUsage } from './llm-usage';
import { logger } from '../logger';
import { grokComplete, grokStream } from './grok-client';
import { claudeCodeComplete, devViaClaudeCode } from './claude-code-dev';

// ---- Key pool + provider failover -------------------------------------------
// ANTHROPIC_API_KEY first, then ANTHROPIC_API_KEYS in order. A key that answers
// "out of credit" / revoked / forbidden is benched for KEY_COOLDOWN_MS and the
// next key is tried. When none is left, LLM_FAILOVER answers from the xAI/OpenAI
// slot (grok-client) so drafting degrades instead of failing outright.

const KEY_COOLDOWN_MS = 10 * 60 * 1000;
const keys = [...new Set([env.ANTHROPIC_API_KEY, ...env.ANTHROPIC_API_KEYS.split(',')].map((k) => k.trim()).filter(Boolean))];
const clients = new Map<string, Anthropic>();
const benchedUntil = new Map<string, number>();

function clientFor(key: string): Anthropic {
  let c = clients.get(key);
  if (!c) { c = new Anthropic({ apiKey: key, maxRetries: 0 }); clients.set(key, c); }
  return c;
}

/** Keys not currently benched, in priority order. */
function liveKeys(): string[] {
  const now = Date.now();
  return keys.filter((k) => (benchedUntil.get(k) ?? 0) <= now);
}

/** A key-level failure: this key can't serve anything, another key might. */
export function isKeyFailure(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  if (err.status === 401 || err.status === 403) return true;
  return err.status === 400 && /credit balance|billing|quota/i.test(err.message);
}

const failoverOn = () => env.LLM_FAILOVER === 'true' && Boolean(env.XAI_API_KEY);

/** The first live key's client (callers that only need "a" client). */
export function anthropic(): Anthropic {
  return clientFor(liveKeys()[0] ?? keys[0] ?? env.ANTHROPIC_API_KEY);
}

/** Run `call` on each live key in turn; bench a key that fails at key level. */
export async function withKeys<T>(call: (c: Anthropic) => Promise<T>): Promise<T> {
  const pool = liveKeys();
  let last: unknown = new Error('no Anthropic API key configured');
  for (const key of pool.length ? pool : keys) {
    try {
      return await call(clientFor(key));
    } catch (err) {
      last = err;
      if (!isKeyFailure(err)) throw err;
      benchedUntil.set(key, Date.now() + KEY_COOLDOWN_MS);
      logger.warn({ key: `…${key.slice(-4)}`, status: (err as { status?: number }).status }, 'anthropic key benched, trying next');
    }
  }
  throw last;
}

/** Normalise the SDK usage (cache_* are number|null) to the shape
 *  anthropicUsage expects (number|undefined), preserving the exact token
 *  numbers the billing layer records. */
export function usageFrom(u: Anthropic.Usage): NormalizedUsage {
  return anthropicUsage({
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_read_input_tokens: u.cache_read_input_tokens ?? undefined,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? undefined,
  });
}

/** Re-shape an SDK error into the HttpRetryError our withRetry() understands,
 *  so 429/5xx keep retrying exactly as the raw-fetch path did. Non-API errors
 *  pass through unchanged. */
export function asRetryError(err: unknown): unknown {
  if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
    return new HttpRetryError(err.status, `Claude API ${err.status}: ${err.message}`);
  }
  return err;
}

export interface ClaudeResult extends NormalizedUsage {
  text: string;
  /** Set when the answer came from the failover provider, e.g. "xai:grok-4". */
  servedBy?: string;
}

export interface ClaudeOptions {
  system: string;
  user: string;
  maxTokens: number;
  /** Defaults to env.ANTHROPIC_MODEL. */
  model?: string;
  /** Prompt-cache the system block (as every former call site did). Default true. */
  cacheSystem?: boolean;
}

/**
 * One-shot completion: system + user → { text, usage }. The drop-in for the
 * former non-streaming `fetch` call sites. Throws HttpRetryError on API errors
 * so an outer withRetry() behaves as before.
 */
export async function claudeComplete(opts: ClaudeOptions): Promise<ClaudeResult> {
  const { system, user, maxTokens, model = env.ANTHROPIC_MODEL, cacheSystem = true } = opts;
  if (devViaClaudeCode()) {
    // Development only (see claude-code-dev): same model, developer's own login.
    // Zero usage: it is not metered, so ai-usage skips the record and the quota.
    const r = await claudeCodeComplete({ system, user, model });
    return { text: r.text, tokensIn: 0, tokensOut: 0, servedBy: `claude-code:${model}` };
  }
  let msg: Anthropic.Message;
  try {
    msg = await withKeys((c) => c.messages.create({
      model,
      max_tokens: maxTokens,
      system: cacheSystem
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : system,
      messages: [{ role: 'user', content: user }],
    }));
  } catch (err) {
    // Only when every key is out of credit / revoked. A 5xx or 529 is transient:
    // it goes back to the caller's withRetry, so Claude — not another model — writes.
    if (isKeyFailure(err) && failoverOn()) {
      logger.warn({ status: (err as { status?: number }).status, model }, `anthropic keys exhausted — failing over to xai:${env.XAI_MODEL}`);
      const r = await grokComplete({ system, user, maxTokens });
      return { ...r, servedBy: `xai:${env.XAI_MODEL}` };
    }
    throw asRetryError(err);
  }
  const text = msg.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('');
  return { text, ...usageFrom(msg.usage) };
}

/**
 * Streaming completion. Yields text deltas as they arrive; reports final usage
 * via onUsage once the stream settles. Replaces the hand-rolled SSE parsing in
 * the streaming call sites (matter-chat, mock-arguments, draft-chat, …).
 */
export async function* claudeStream(
  opts: ClaudeOptions & { onUsage?: (u: NormalizedUsage) => void },
): AsyncGenerator<string, void, void> {
  const { system, user, maxTokens, model = env.ANTHROPIC_MODEL, cacheSystem = true, onUsage } = opts;
  // Stream on the first live key. If it refuses BEFORE any text (credit / auth /
  // outage), try the next key, then the failover provider. A stream that already
  // yielded text can't be restarted, so a later error propagates as before.
  let yielded = false;
  if (devViaClaudeCode()) {
    // The developer's own login: not metered usage, so no onUsage.
    yield (await claudeCodeComplete({ system, user, model })).text;
    return;
  }
  const pool = liveKeys();
  let last: unknown = new Error('no Anthropic API key configured');
  for (const key of pool.length ? pool : keys) {
    try {
      yield* streamOn(key);
      return;
    } catch (err) {
      if (yielded || !isKeyFailure(err)) throw err;
      last = err;
      benchedUntil.set(key, Date.now() + KEY_COOLDOWN_MS);
    }
  }
  if (!failoverOn()) throw last;
  logger.warn({ model }, `anthropic keys exhausted — failing over to xai:${env.XAI_MODEL}`);
  yield* grokStream({ system, user, maxTokens, ...(onUsage ? { onUsage } : {}) });

  async function* streamOn(key: string): AsyncGenerator<string, void, void> {
  const stream = clientFor(key).messages.stream({
    model,
    max_tokens: maxTokens,
    system: cacheSystem
      ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
      : system,
    messages: [{ role: 'user', content: user }],
  });

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta' &&
      event.delta.text
    ) {
      yielded = true;
      yield event.delta.text;
    }
  }

  // Final message carries authoritative usage.
  if (onUsage) {
    try {
      const final = await stream.finalMessage();
      onUsage(usageFrom(final.usage));
    } catch { /* usage is best-effort; a stream that already yielded text stands */ }
  }
  }
}
