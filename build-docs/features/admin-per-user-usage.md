# Feature: Per-user AI usage + caps (admin)

Status: **built 2026-11-17 (branch feat/admin-console-v2), not deployed.** As built: report shows credits used in the chosen window (not the plan cycle); the cap itself counts the plan cycle. Web shows the server's message for user_cap_reached (no credits sheet, since buying credits wouldn't help).

## Purpose
- See which advocate uses how much AI, and stop one user draining a firm's shared credit pool.

## Architecture
- **Data already exists:** `ai_token_usage.user_id` (tokens, model, feature) and `credit_ledger.user_id` (credits spent). No new tracking.
- **Report:** `GET /admin/ai-usage/users?days=&firmId=` → per user: name, firm, role, calls, tokens in/out, est. ₹ cost, credits spent this cycle, top feature, cap. Sorted by cost. One SQL with two grouped CTEs, bounded window (≤ 365 d).
- **Cap:** `users.credit_cap_month numeric null` (migration 0114; half-credit steps; null = no cap).
    - Enforced in `credit.service` where `assertNotMunshi` already reads the user: credits this user spent since the firm's current cycle start + this charge > cap → 402 `user_cap_reached` ("Your monthly AI limit set by DifAi is reached"); nothing taken.
    - Applies to `charge`, `assertAvailable`, `meterDraft` growth.
- **UI:** new "Per user" tab in AI usage view; cap editor on the user row and on Firm 360 → Members.

## Impact map
- `services/credit.service.ts`: charge path for every AI feature. Risk: wrong cycle start blocks users → reuse `ensurePlanGrant` cycle; tests on cycle boundaries.
- Web: credit-exhausted UI must show the new code's message (check `CreditsExhausted` handling in web).
- `routes/admin.routes.ts`: report + `PATCH /admin/users/:id/credit-cap`.
- Firm owners: out of scope (cap is set by DifAi admin only; firm-owner caps can come later).

## Edge cases
- User moves firm → cap counts only spend in the current firm's cycle.
- Refunded charges don't count (ledger nets refunds).
- Cap below already-spent → next charge refused, nothing clawed back.
- Deleted user → rows show "deleted user".
- Cap set to 0 → AI off for that user.

## Acceptance criteria
1. Per-user table totals equal the per-firm totals for the same window.
2. Cap 10 → user can spend 10 credits this cycle, the 11th returns 402 `user_cap_reached`, firm pool untouched by the refused call.
3. Other users in the firm unaffected.
4. Cycle reset → user can spend again.
5. Cap changes audited.
