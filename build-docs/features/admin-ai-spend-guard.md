# Feature: AI spend guard (admin)

Status: **design, awaiting owner approval (2026-11-17).**

## Purpose
- Owner wants "API auto pay controlled from our dashboard". Anthropic's API **cannot** top up or auto-reload credit (Admin API: usage/cost read only; spend limits only Enterprise / early-access). So DifAi controls the *spend*, not the top-up:
    - see real provider spend (Anthropic + OpenAI) next to our own estimate;
    - a monthly AI budget with alerts;
    - a pause switch (whole platform or one firm).
- Top-up / auto-reload stays in the Anthropic Console; the card links there.
- Also fixes: prod overview shows **0 AI tokens in 30 days** although drafts are being made. Find the cause first (step 0).

## Architecture
- **Step 0 — usage recording check:** read-only count of `ai_token_usage` on prod by day/feature; trace one live call through `lib/anthropic-client.ts` → `aiUsageService.record`. Fix the root cause before building on the numbers.
- **Provider spend (read):**
    - Anthropic: `GET /v1/organizations/analytics/cost` (beta `analytics-usage-cost-2026-08-24`) with a new server-only `ANTHROPIC_ADMIN_KEY` (`sk-ant-admin…`). Data lags 4–24 h; shown as "as of <data_refreshed_at>".
    - OpenAI (Contract Review): OpenAI organization costs API with `OPENAI_ADMIN_KEY`. Optional: card hides if the key is absent.
    - Cached 15 min in memory; never called from the browser.
- **Budget + alerts:** new row in a `platform_settings` key/value table (migration 0114): `ai_budget_usd_month`, `ai_alert_pcts` (default 80,100). Hourly job (existing pg-boss) compares month-to-date spend (provider figure if available, else our estimate) → bell + email to superadmins once per threshold per month.
- **Pause switch:**
    - `platform_settings.ai_paused` (all) and `firms.ai_paused` (one firm), migration 0114.
    - Enforced in one place: `withKeys()` in `lib/anthropic-client.ts` + the OpenAI review call throw `AiUnavailableError` (existing class → advocates already see "AI unavailable"). Check is cached 30 s.
    - Optional auto-pause at 100% of budget (setting `ai_autopause`, default **off**).
- **UI:** "AI spend" card on Overview + section in AI usage view: month-to-date ₹/$, budget bar, provider vs estimate, pause toggles (confirm dialog), link to Anthropic Console billing.

## Impact map
- `lib/anthropic-client.ts` (`withKeys`, `claudeStream`): every AI feature passes here. Risk: a bad check blocks all AI → check fails *open* on DB error, logged.
- `services/review.service.ts` (OpenAI path): same guard.
- `services/ai-usage*.ts`, `lib/ai-pricing.ts`: estimate source; step-0 fix may touch callers.
- `routes/admin.routes.ts`: new `GET/PATCH /admin/ai-spend`, `PATCH /admin/firms/:id/ai-pause`.
- Jobs (pg-boss schedule): new `ai.budget.check` hourly.
- Credits: a paused call must not charge → guard runs before `creditService.charge` or the charge is refunded by existing `withCredits`.
- Env: `ANTHROPIC_ADMIN_KEY`, `OPENAI_ADMIN_KEY` only in `/etc/lexdraft/secrets.env` (key-lockdown rule).
- Migration 0114 on prod + Supabase: additive only; needs owner go.

## Edge cases
- Admin key missing/invalid → card shows "connect admin key", estimate only; no crash.
- Provider API 410/429 → keep last cached figure, show its age.
- Budget 0/empty → alerts off.
- Pause while a draft is streaming → current stream finishes; next call refused.
- Superadmin's own impersonated session is paused like the firm.
- Audit: every budget/pause change in audit log.

## Acceptance criteria
1. Overview AI tokens/cost match a prod SQL count for the same window (step 0 fixed).
2. With a valid admin key, month-to-date Anthropic $ shows with "as of" time; without it, an estimate with a clear label.
3. Budget alert fires once at 80% and once at 100% per month (bell + email), not repeatedly.
4. Platform pause → every AI endpoint returns the "AI unavailable" error, no credits charged; unpause restores within 30 s.
5. Firm pause affects only that firm.
6. Every change appears in the audit log with actor.
