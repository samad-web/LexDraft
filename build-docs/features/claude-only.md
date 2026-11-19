# Claude only

Status: BUILT + tested 2026-11-19 (owner: "claude only"). Reverses 2026-11-08 Contract Review on OpenAI and the OpenAI fallbacks.

## Purpose
Sales material promises client facts are never used for training and stay with the firm. Only Claude (Anthropic business API) may receive them; no xAI/OpenAI path may exist in prod, whatever the server .env says.

## Architecture
- `env.ts claudeOnly()` runs at boot: blanks XAI_API_KEY and OPENAI_API_KEY; LLM_PROVIDER/INTAKE_PROVIDER `xai` → `anthropic`; REVIEW_PROVIDER → `default`; LLM_FAILOVER → `false`. Logs the settings it ignored.
- Backstop: `lib/grok-client grok()` throws without a key, so the OpenAI-compatible client can never send a request.
- Every caller already checks `env.XAI_API_KEY` / `env.llmProvider`, so they all resolve to Claude (drafting, intake, diary assistant, draft chat, review, format reader fallback → 503 instead).

## Impact map
- Contract Review now on Claude (was OpenAI). Format reading: no OpenAI fallback when Claude fails. No failover to another vendor when Anthropic keys fail (requests fail instead).
- Embeddings are self-hosted bge-m3 (not a vendor) — unchanged. Engine transcribe uses Anthropic only.

## Acceptance criteria
- AC1 prod-like config is rewritten to Claude only. AC2 Claude-only config untouched. AC3 running env never resolves to xai. AC4 OpenAI-compatible client refuses without key.
