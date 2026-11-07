# Drafting efficiency (2026-11-07)

## Purpose
Raise how many drafts production can run at once, without new infrastructure. Today the ceiling is about 10–15 drafts at the same moment (estimate; see the capacity doc).

## Scope (approved 2026-11-07)
1. ~~Debounce the preview PDF~~: **dropped after reading the code.** React already skips the conversion when the .docx is unchanged, and every change comes from a discrete event that is already debounced (live fields 900 ms, Redraft accept, a new turn). A debounce would add nothing.
2. **Engine workers:** `ENV WEB_CONCURRENCY=2` in `lexdraft-engine/Dockerfile`. uvicorn reads it as `--workers`. Override per server with `docker run -e WEB_CONCURRENCY=<cores-1>`.
3. **Progress poll exempt from the IP limiter:** `apiIpLimiter()` in `middleware/rateLimit.ts` (moved from `app.ts`, same limits) skips `GET /api/drafting/progress`.

## Impact map
- Engine workers: every `/v1/*` call. State check: sign-offs are re-read from `verify/signoff_audit.jsonl` on every check (no per-process cache). Appends are one short `O_APPEND` line, atomic on Linux. `verify/tables` caches read-only JSON. RAM grows per worker (each loads all pipelines).
- IP limiter: all `/api` traffic. Only the exact GET path is exempt. The poll stays behind `requireAuth` + `requireActivePlan` and does no work (in-memory map read).

## Edge cases
- WEB_CONCURRENCY too high for the VPS RAM → OOM kills. Default 2 is conservative; raise only after checking `free -h`.
- Spoofed poll flood: still needs a valid session; GET-only, constant-time, no DB.
- POST, or a path that only starts with the progress path → still counted.

## Acceptance criteria
- Engine starts N server processes when `WEB_CONCURRENCY=N` and answers concurrent requests.
- Progress polls neither consume nor are blocked by the IP budget; other routes are still limited at the same ceiling.

## 4. Live edits engine-only (user chose 2026-11-07)
- Typing in "Missing details" sends `/engine/intake/edit` with `draftNow: true, compose: false`: engine re-draft only. No compose, no AI fallback, no model call. Skips `llmGenerationLimiter` and the AI quota (`isEngineOnlyEdit`); the per-user write limiter (120/15 min) still applies.
- After an engine-only update the panel shows "Update document"; it re-sends the edits made since the last polish with compose on.
- Only the newest request updates the document (sequence guard), so a slow compose reply cannot overwrite a newer edit.
- Bypass check: `compose:false` without `draftNow`, or a non-boolean, stays limited. Other routes ignore `compose`.
- Impact: `intake.service` edit + `_evaluate` (default unchanged for every other caller), `drafting.routes` edit route, `IntakeEditRequest` type, `LiveDetailsPanel`.
- Acceptance: typing makes zero model calls; "Update document" composes once; a blocked edit while typing returns the refusal, not an AI draft.
