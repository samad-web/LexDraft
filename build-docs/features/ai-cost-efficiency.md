# AI cost efficiency (2026-11-11)

## Purpose
Cut drafting AI spend on Sonnet 5.5 without changing draft quality. Today no call sets an effort level, so every call runs Sonnet 5.5's default (`high`). Thinking is billed as output ($10/MTok), even for one-word tasks like picking a document type.

## Scope (approved 2026-11-11: "proceed with Sonnet 5.5, quality must not change")
1. **Pricing fix:** `ai-pricing.ts` gets `gpt-5.5` ($5 / $30). Contract Review spend was shown at Sonnet 4.6 rates (about half the real cost). Reporting only.
2. **Effort option:** the intake call (`intake-llm` `callClaude`) and the dev route take an optional `effort`; the shared `claudeComplete` / `claudeStream` are not touched (no caller needs it). It goes to the API as `output_config.effort` and to the dev route as `--effort`. **Omitted = no change** (model default).
3. **Effort per intake call** (`intake-llm.service.ts`), kept only if the quality gate passes:
   - `classifyDocType` (one label, 200 tokens) → `low`
   - `phrase` (wording of questions the engine already chose) → `low`
   - `extract` (facts into fields) → **stays default**: failed the gate at `medium` (see result)
   - `checkBrief`, the draft-writing call (`intake.service` compose) and every other feature → **unchanged**.

Out of scope: Haiku, moving Contract Review off OpenAI, Batch API, prompt edits.

## Impact map
- `lib/anthropic-client.ts`: not changed. Other features send exactly the same requests.
- `env.ts`: new `INTAKE_EFFORT_TUNED` (default `true`).
- `lib/claude-code-dev.ts`: dev route only; adds `--effort` when given.
- `services/intake-llm.service.ts`: intake classify / phrase / extract. Feeds the engine, so a worse extraction = a worse draft. Hence the gate.
- `lib/ai-pricing.ts`: admin AI-usage dashboard numbers only.
- Failover to OpenAI: `grokComplete` ignores effort (no change).
- Prompt cache: effort does not change the cached system prefix.

## Edge cases and failure modes
- Unknown effort value: typed union, so it can't be sent.
- Lower effort truncates or skips a field: caught by the gate; `extract` already retries with a larger cap on truncation.
- Model that rejects effort: only Sonnet 5.5 is configured, and it accepts every level.
- Dev route on an old CLI without `--effort`: the CLI errors and the existing fallback path logs it; the installed CLI (2.1.322) has the flag.

## Quality gate (acceptance)
- Same briefs from `benchmark-h2h/b1–b4`, run through intake on the dev route at default effort and at the new effort.
- `classifyDocType`: same document type on every brief.
- `extract`: same set of filled fields and same values (dates, amounts, names, places) on every brief, allowing only wording-equivalent differences, checked against a second default-effort run for noise.
- `phrase`: one question per engine issue, still (`reconcile()` already enforces the set).
- Any loss → that call goes back to default; the rest ship.
- Unit: effort reaches the request when set; absent when not set; dev route passes `--effort`; `gpt-5.5` priced at $5 / $30.

## Result (2026-11-11, 12 briefs from b1–b4, dev route)
- classify: 12/12 same document as both default runs. phrase: every issue got a question (24/24). Both ship at `low`.
- extract at `medium`: recall_petition put "C.C. No. 412 of 2025" in `cc_no` and dropped `case_ref` (both default runs filled both correctly); court_name lost "Madurai". Reverted to default.
- Other extract differences were wording only, the same size as default-vs-default noise.
- Kill switch: `INTAKE_EFFORT_TUNED=false` restores the old requests without a deploy.
