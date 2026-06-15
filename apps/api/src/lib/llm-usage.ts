/**
 * Normalises the per-provider `usage` object returned by Anthropic / xAI into a
 * single shape so token spend (including prompt-cache classes) can be recorded
 * uniformly via aiUsageService.
 *
 * Anthropic: `input_tokens` already EXCLUDES cached tokens; cache reads/writes
 * are reported separately.
 * xAI (OpenAI-compatible): `prompt_tokens` INCLUDES cached tokens, surfaced
 * under `prompt_tokens_details.cached_tokens`, so we subtract them out to get
 * the fresh-input count. xAI has no separate cache-write class.
 */

export interface NormalizedUsage {
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface XaiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

export function anthropicUsage(u?: AnthropicUsage): NormalizedUsage {
  if (!u) return {};
  return {
    tokensIn: u.input_tokens,
    tokensOut: u.output_tokens,
    cacheRead: u.cache_read_input_tokens,
    cacheWrite: u.cache_creation_input_tokens,
  };
}

export function xaiUsage(u?: XaiUsage): NormalizedUsage {
  if (!u) return {};
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const prompt = u.prompt_tokens ?? 0;
  return {
    tokensIn: Math.max(0, prompt - cached),
    tokensOut: u.completion_tokens,
    cacheRead: cached,
    cacheWrite: 0,
  };
}
