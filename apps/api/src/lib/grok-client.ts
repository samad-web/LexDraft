// =============================================================================
// grok-client — the single official-SDK xAI (Grok) client for the whole API.
//
// xAI has no first-party TS SDK; Grok's API is OpenAI-compatible, so the
// supported "SDK not raw fetch" path is the `openai` package pointed at
// api.x.ai. Every service that used to hand-roll `fetch('https://api.x.ai/v1/
// chat/completions')` now goes through here. Mirrors anthropic-client.ts:
// non-streaming `grokComplete` + streaming `grokStream`, same retry→HttpRetryError
// shaping and the same xaiUsage token mapping the billing/quota code reads.
//
// Auth: one server-side org key (XAI_API_KEY). maxRetries:0 because callers
// wrap us in their own withRetry.
// =============================================================================

import OpenAI from 'openai';
import { env } from '../env';
import { HttpRetryError } from './retry';
import { xaiUsage, type NormalizedUsage } from './llm-usage';

let client: OpenAI | null = null;
export function grok(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: env.XAI_API_KEY,
      baseURL: 'https://api.x.ai/v1',
      maxRetries: 0,
    });
  }
  return client;
}

/** Re-shape an OpenAI-SDK error into the HttpRetryError our withRetry()
 *  understands, so 429/5xx keep retrying exactly as the raw-fetch path did. */
export function asRetryError(err: unknown): unknown {
  if (err instanceof OpenAI.APIError && typeof err.status === 'number') {
    return new HttpRetryError(err.status, `xAI API ${err.status}: ${err.message}`);
  }
  return err;
}

/** OpenAI's usage type is nominally different from xaiUsage's input; the wire
 *  fields (prompt_tokens, completion_tokens, prompt_tokens_details.cached_tokens)
 *  are identical, so pass it through unchanged. */
function usageFrom(u: OpenAI.CompletionUsage | undefined): NormalizedUsage {
  return xaiUsage(u as Parameters<typeof xaiUsage>[0]);
}

export interface GrokResult extends NormalizedUsage {
  text: string;
}

export interface GrokOptions {
  system: string;
  user: string;
  maxTokens: number;
  /** Defaults to env.XAI_MODEL. */
  model?: string;
}

/** One-shot completion: system + user → { text, usage }. Drop-in for the former
 *  non-streaming Grok fetch. Throws HttpRetryError on API errors. */
export async function grokComplete(opts: GrokOptions): Promise<GrokResult> {
  const { system, user, maxTokens, model = env.XAI_MODEL } = opts;
  let res: OpenAI.Chat.Completions.ChatCompletion;
  try {
    res = await grok().chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
  } catch (err) {
    throw asRetryError(err);
  }
  return { text: res.choices[0]?.message?.content ?? '', ...usageFrom(res.usage) };
}

/** Streaming completion. Yields text deltas; reports final usage via onUsage
 *  once the stream settles (include_usage adds a final usage-only chunk). */
export async function* grokStream(
  opts: GrokOptions & { onUsage?: (u: NormalizedUsage) => void },
): AsyncGenerator<string, void, void> {
  const { system, user, maxTokens, model = env.XAI_MODEL, onUsage } = opts;
  let stream: Awaited<ReturnType<ReturnType<typeof grok>['chat']['completions']['create']>>;
  try {
    stream = await grok().chat.completions.create({
      model,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
  } catch (err) {
    throw asRetryError(err);
  }

  let usage: NormalizedUsage = {};
  for await (const chunk of stream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
    // The include_usage final chunk carries usage with an empty choices array.
    if (chunk.usage) usage = usageFrom(chunk.usage);
  }
  onUsage?.(usage);
}
