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

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0 });
  return client;
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
  let msg: Anthropic.Message;
  try {
    msg = await anthropic().messages.create({
      model,
      max_tokens: maxTokens,
      system: cacheSystem
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : system,
      messages: [{ role: 'user', content: user }],
    });
  } catch (err) {
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
  const stream = anthropic().messages.stream({
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
