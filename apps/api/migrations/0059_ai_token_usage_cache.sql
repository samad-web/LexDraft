-- =============================================================================
-- LexDraft - AI token usage: prompt-cache token classes
-- =============================================================================
-- Anthropic (and xAI) bill cached input tokens at different rates than fresh
-- input: cache READS are ~0.1x base input price, cache WRITES ~1.25x. Our
-- services send the system prompt with cache_control=ephemeral, so a large
-- share of input is actually one of these classes - ignoring them makes the
-- computed cost diverge from the real bill.
--
-- We split the input token count into three columns so cost can be computed
-- precisely at read time:
--   tokens_in           - fresh (uncached) input tokens, billed at 1x
--   cache_read_tokens   - served from cache, billed at ~0.1x
--   cache_write_tokens  - written to cache this call, billed at ~1.25x
--
-- The provider's `input_tokens` field already EXCLUDES cached tokens, so
-- tokens_in keeps its existing meaning and the two new columns are additive.
--
-- Idempotent.
-- =============================================================================

alter table ai_token_usage
  add column if not exists cache_read_tokens  integer not null default 0 check (cache_read_tokens  >= 0),
  add column if not exists cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0);
