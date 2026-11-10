# Check what's missing (Draft box)

## Purpose
Advocates type thin or long briefs; the draft then fills gaps with [blanks]. A button lists the facts the document still needs before drafting. Chosen over an AI rewrite of the text (user, 2026-11-10): a rewrite can change a date, amount or name.

## Architecture
- UI: "Check what's missing" button in the chat area (inline DraftBotModal, next to the "Covers" ticks), enabled at 10+ characters. Result in `BriefCheckNote` (role=status, monochrome). Cleared on Submit/reset. Text is never changed.
- API: `POST /drafting/engine/intake/check-brief { message }` → `{ docLabel, title, missing[≤6], question }`. Guards: drafting.ai feature, LLM rate limiter, quota assert; usage recorded as drafting.
- `intakeLlm.checkBrief`: one call on the intake model; docLabel only from the routable + firm labels; notListed name as title; question → no list.

## Impact map
- `intake-llm.service` (new method), `intake.service.checkBrief`, `drafting.routes` (new route), `useIntake` (hook), `DraftBotModal` inline layout. No DB change, no matter created.

## Edge cases
- Model returns non-JSON → empty result ("nothing missing"); account failure → 503 ai_unavailable; quota → 402/429 path; injection inside text ignored by prompt; >6 items trimmed; made-up label dropped.

## Acceptance
- Unit: checkBrief 5 tests, BriefCheckNote 3 tests.
- Live (Agent SDK): 4 briefs → right document, concrete missing facts, none already given; question recognised.
