/**
 * AI cost estimation.
 *
 * Per-model token pricing, USD per MILLION tokens, used to turn raw token
 * counts from ai_token_usage into an *estimated* spend for the superadmin
 * dashboard. Pricing changes over time, so cost is computed at read time from
 * this map rather than persisted on each row.
 *
 * Anthropic prices are from the published rate card (cached 2026-05-26).
 * xAI (Grok) prices are best-effort estimates - adjust XAI_* if the rate card
 * changes. Unknown models fall back to DEFAULT_PRICING.
 *
 * Costs surfaced from this module are ESTIMATES; the UI labels them as such.
 */

export interface ModelPrice {
  /** USD per 1,000,000 input tokens. */
  inputPerMTok: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMTok: number;
}

// USD per million tokens.
const ANTHROPIC_OPUS: ModelPrice = { inputPerMTok: 5, outputPerMTok: 25 };
const ANTHROPIC_SONNET: ModelPrice = { inputPerMTok: 3, outputPerMTok: 15 };
const ANTHROPIC_HAIKU: ModelPrice = { inputPerMTok: 1, outputPerMTok: 5 };
const XAI_GROK: ModelPrice = { inputPerMTok: 3, outputPerMTok: 15 };

/** Conservative fallback when a model id isn't recognised - use Sonnet rates. */
export const DEFAULT_PRICING: ModelPrice = ANTHROPIC_SONNET;

// Exact-id lookups first; substring rules below cover version-suffixed ids.
const EXACT: Record<string, ModelPrice> = {
  'claude-sonnet-4-6': ANTHROPIC_SONNET,
  'claude-haiku-4-5': ANTHROPIC_HAIKU,
  'claude-opus-4-8': ANTHROPIC_OPUS,
  'claude-opus-4-7': ANTHROPIC_OPUS,
  'claude-opus-4-6': ANTHROPIC_OPUS,
  'grok-4': XAI_GROK,
};

/** Resolve a model id (possibly null / version-suffixed) to a price card. */
export function priceFor(model: string | null | undefined): ModelPrice {
  if (!model) return DEFAULT_PRICING;
  const id = model.toLowerCase();
  if (EXACT[id]) return EXACT[id];
  if (id.includes('opus')) return ANTHROPIC_OPUS;
  if (id.includes('sonnet')) return ANTHROPIC_SONNET;
  if (id.includes('haiku')) return ANTHROPIC_HAIKU;
  if (id.includes('grok')) return XAI_GROK;
  return DEFAULT_PRICING;
}

// Prompt-cache multipliers relative to the base input rate (Anthropic's
// published ratios; xAI matches closely). A cache READ is ~0.1x base input; a
// cache WRITE (5-minute TTL) is ~1.25x base input.
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

/**
 * USD cost for a token bucket on a given model, accounting for prompt-cache
 * token classes. This is the actual list-price cost (the only gap to a real
 * invoice would be a private enterprise discount, which no API exposes).
 *
 * `tokensIn` is fresh/uncached input; cache reads and writes are billed at
 * their own multipliers off the base input rate.
 */
export function estimateCostUsd(
  model: string | null | undefined,
  tokensIn: number,
  tokensOut: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  const p = priceFor(model);
  const inputCost =
    (tokensIn / 1_000_000) * p.inputPerMTok +
    (cacheReadTokens / 1_000_000) * p.inputPerMTok * CACHE_READ_MULT +
    (cacheWriteTokens / 1_000_000) * p.inputPerMTok * CACHE_WRITE_MULT;
  return inputCost + (tokensOut / 1_000_000) * p.outputPerMTok;
}

/** USD→INR conversion used for the rupee figure on the dashboard. Approximate. */
export const USD_INR = 84;
