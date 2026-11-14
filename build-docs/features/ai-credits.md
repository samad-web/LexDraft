# Feature: AI credits (every AI feature metered; drafted pages beyond the balance locked)

Status: **built 2026-11-14** (approved 2026-11-14; free launch = 25 credits a month; Brief Packs in this release, see features/brief-packs.md). Migration **0108** (not 0105: taken by billing), applied locally only. Deploy together with pricing v4. Replaces the draft-count quota (`ai-quota.service.ts`, pricing v2 phase A). Credit numbers come from the pricing v4 draft and are NOT final, so they live in one config file.

## Purpose
- Pricing v4 sells AI in credits (1 credit = one 400-word drafted page). Today the app only counts drafts, so credits don't exist.
- User's ask: draft as far as the credits go, **lock the pages beyond the balance**, tell the user to upgrade. Do the same for every AI feature.

## What exists (reuse)
- `ai-quota.service.ts`: per-user monthly draft count from `ai_generations`, cap from `plan_ai_caps` / `FREE_AI_MONTHLY_CAP`, 429 `ai_quota_exceeded`. Called by ~15 AI entry points via `assertCanGenerate`.
- `ai-usage.service.ts`: per-call token/cost log per feature. Stays as is (cost tracking, /admin AI cost).
- `document-render.service.ts`: engine .docx → stored docx + PDF preview (`draft_renders`). Single render path.
- `billing.service.ts` / Dodo webhook: the only thing that changes a plan.

## Credit cost per AI action (v4 draft numbers, `lib/credit-costs.ts`, mirrored in web)
| Action (entry point) | Credits |
|---|---|
| Draft (intake, generate, stream, agent, open drafting, firm-format generate) | 1 per 400 words of the final draft, rounded up to ½, min 1 |
| "Update document" polish / redraft / revise a section | ½ per page rewritten, min ½ |
| Live "Missing details" typing (engine only, no model) | 0 |
| Draft-box question, matter chat, diary assistant, document ask | ½ |
| Check what's missing (draft review / brief check) | 1 |
| Extract facts from a document (draft-extract) | ½ |
| Legal research / Related law | 2 |
| Matter intel / case summary | 2 |
| Mock arguments session | 3 |
| Contract review | 6 up to 10 pages, then ½ per extra page |
| Title report AI read | ½ |
| Upload a format (format reader) | 2 (not in v4; my proposal) |
| Diary, eCourts, eFiling, limitation calc, land-record fetch, documents, billing | 0 |

## Architecture
### Data model (migration 0105, additive)
- `credit_grants(id, firm_id, user_id null = shared pool, source plan|topup|free_launch|admin, amount numeric(8,1), remaining numeric(8,1), cycle_start, expires_at, created_at)`.
- `credit_ledger(id, firm_id, user_id, action, credits numeric(8,1), ref_key text unique, grant_id, kind spend|refund|unlock, meta jsonb, created_at)`. `ref_key` makes every charge idempotent (retries never double-charge).
- `draft_locks(render_id pk, total_words, paid_words, credits_needed, created_at)` — present only while a draft is partly locked.
- Plan allowance per tier in `plan_credit_allowance` (replaces `plan_ai_caps` use; old table left in place).

### Service `credit.service.ts`
- `balance(firmId, userId)` — sum of unexpired `remaining`; lazily creates this cycle's plan grant (no cron; same cycle rule as today: `renews_at` or calendar month).
- `charge(ctx, action, refKey, credits)` — one transaction, grants `FOR UPDATE` ordered by `expires_at` (soonest first, top-ups last). Not enough → throws `CreditsExhaustedError` (402 `credits_exhausted`, with balance, needed, renew date).
- `chargeUpTo(ctx, refKey, credits)` — takes what's available in ½ steps, returns credits paid (drafting only).
- `refund(refKey)` — reversal row; used when the AI call fails after charging.

### Flow: fixed-cost features (chat, research, mock, review, …)
- Charge **before** the model call (atomic, so two tabs can't overspend), refund on failure. Not enough credits → 402, no model call, upgrade sheet.

### Flow: drafting (the lock)
1. Before drafting: balance must be ≥ 1 credit, else 402 (no AI spent).
2. Draft fully. Count words of the final document → pages needed.
3. `chargeUpTo(pages)`. If paid < needed: keep the full .docx server-side only; build the client copy cut at the last paragraph ending within `paid × 400` words; render the preview PDF from the cut copy; write `draft_locks`.
4. Response carries `locked: { lockedPages, creditsNeeded }`. UI shows the paid pages, then a locked card: "3 more pages drafted and locked · needs 3 credits · Upgrade plan".
5. `POST /drafting/renders/:id/unlock` charges the rest and releases the full draft. Offered automatically after an upgrade/top-up.
6. While locked: download, copy-all, eSign, eFiling bundle and paragraph editing are off for that draft; "Missing details" typing still re-renders (free) and re-cuts at `paid_words`.
- **The lock is server-side.** Locked text never reaches the browser (no CSS blur over real text), in any channel: JSON blocks, docx, PDF, saved draft, export, eFiling, eSign.

### UI
- Credit meter in the composer header and Plan & Billing ("42 of 70 credits · resets 1 Dec"); cost shown on each AI button ("½ credit"); notice at 80% and 100%.
- One shared `UpgradeSheet` for every 402 `credits_exhausted` (web: See plans → /app/billing). **Android app: no buy button** (2026-11-03 decision) — text only: "Credits finished. Manage your plan from the DifAi website."
- Admin: credits used/left per user in /admin/users; superadmin can add an `admin` grant (support/goodwill), logged.

## Impact map
| Touches | Change | Risk |
|---|---|---|
| ~15 AI entry points (list above) | `assertCanGenerate` → `creditService.charge`/`chargeUpTo` | Missing one = free AI; a test enumerates every entry point |
| `ai-quota.service.ts`, `plan_ai_caps`, `ai_generations` | Retired from enforcement (kept for history) | Old quota tests rewritten to credit tests |
| `drafting.routes.ts`, `intake.service.ts`, `document-render.service.ts`, `engine-client` applyEdits/splice | Cut client copy, lock rows, unlock route | Full text leaking through an unpatched path (blocks, docx, PDF, saved draft) |
| `drafts.routes.ts`, eSign, eFiling bundle, export | Refuse a locked draft (409 `draft_locked`) | Filing a half document |
| `billing.service.ts` / webhook | Plan change → new allowance applies this cycle | Upgrade mid-cycle grants the difference, not a second full grant |
| `lib/free-plan.ts` | Free-launch accounts get a credit allowance (see decision) | Users promised "unlimited drafting" at launch |
| Web: composer, DraftBotModal, chat, research, mock args, review, title reports, billing view | Meter, cost labels, UpgradeSheet, locked card | Android purchase-UI rule |
| Migration 0105 | New tables | Live DB change → **needs approval** for Supabase + prod |

## Edge cases and failure modes
- AI fails after charge → refund (same `ref_key`). Engine render fails → nothing charged.
- Retry of the same request → same `ref_key`, charged once.
- Two parallel requests at the edge → row lock; the second gets 402 (fixed cost) or a locked draft.
- Balance 0.5 and a draft needs ≥ 1 → refused before drafting (no wasted AI).
- Locked draft never unlocked → full copy kept 30 days, then the lock row and hidden copy are deleted (cut copy stays).
- Re-rendering the same draft (typing) → no new charge; "Update document" on 2 pages → 1 credit.
- Plan expires/cancelled → plan credits lapse at period end; top-ups stay 12 months.
- Downgrade mid-cycle → current grant kept until cycle end.
- Security: credit amounts and refKeys are server-computed; the client never sends a cost or page count. Unlock only by a member of the draft's firm.

## Acceptance criteria
1. Every AI entry point charges its listed cost exactly once; a test fails if a new AI route has no charge.
2. With 0 credits, every AI feature returns 402 `credits_exhausted` before any model call; diary/eCourts/eFiling/limitation keep working.
3. A 6-page draft with 3 credits: 3 charged, client gets ~1,200 words + `locked {lockedPages: 3, creditsNeeded: 3}`; no response, docx or PDF for that draft contains text past the cut.
4. Download/eSign/eFiling of a locked draft → 409 `draft_locked`.
5. After adding 3 credits, unlock charges 3 and returns the full draft; a second unlock charges 0.
6. Failed AI call → net 0 credits. Retried request → charged once.
7. Two concurrent ½-credit chats with ½ left → exactly one succeeds.
8. Meter shows used/left/reset; 80% and 100% notices; Android shows no buy button.
9. Web and API credit-cost tables match (test).

## As built (2026-11-14)
- **Pool:** one shared pool per firm (`credit_grants`). This month's plan grant is created lazily on the first balance or charge; yearly plans still reset monthly, on the renewal day. Upgrade mid-cycle adds the difference; downgrade keeps the bigger grant until the cycle ends. Plan credits: Sanad 25, Vakalat 75, Brief 200, Associates 75 × advocates; free launch 25 (owner, 2026-11-14); an unpaid v4 sign-up 0; Munshi seats 0.
- **Spend order:** soonest expiry first, so plan credits go before Brief Packs. Row locks on the firm + grants make two tabs unable to overspend (tested on real Postgres).
- **Drafts:** a draft's pages are charged once (`metered_drafts`, key `intake:<matter>:<doc>` or `text:<uuid>`). Re-rendering is free; only growth past the paid pages costs. Starting needs ≥ 1 credit.
- **The lock:** pages past the balance are cut server-side before the response:
    - intake JSON blocks, the .docx (rebuilt with `applyEdits`; if that can't match, no .docx is sent), and the companion draft;
    - plain text (generate) and pipeline blocks (auto / chat / pipeline);
    - streams send deltas only up to the balance, then a `locked` event.
  The full text never reaches the browser. Unlock = `POST /api/credits/unlock` (all or nothing, firm-scoped).
- **Locked drafts:** the cut copy carries a lock notice. Saving a draft (POST/PUT /drafts) and uploading a pleading to eFiling refuse it with 409 `draft_locked`. The composer hides Export and Share while locked.
- **Costs as built:** the table above, plus:
    - mock arguments: 3 when the session starts (turns, conclude and review rerun included); the upload step needs 3 on hand.
    - matter intel: 2 per summary (also the automatic one after upload; skipped when out) and 2 per brief regenerate.
    - title report: ½ at create.
    - diary command: ½ (falls back to the free heuristic when out); judgment analysis ½.
- **Deviation (needs owner OK):** the diary **briefing narrative** (written automatically when the diary opens) is not charged, only shown while credits remain. Charging ½ per page view would drain credits silently.
- **Small race accepted:** a stream sends up to the balance read at its start; a parallel spend in another tab can make that a few hundred words more than charged.
- **UI:**
    - credit meter on Plan & Billing and in the Draft composer;
    - 402 `credits_exhausted` opens the credits sheet (Android: text only, no buy button);
    - cost on "Check what's missing" and the Draft button;
    - locked-draft card with Unlock;
    - admin: firm credits + audited goodwill grant (`firm.credits.grant`).
- **Retired from enforcement:** `ai-quota.service` assertCanGenerate (tables kept for history). AC1 has a test that fails when a route behind the AI rate limit has no credit charge.
