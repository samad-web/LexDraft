# Feature: Firm 360 + current plans on the admin console

Status: **design, awaiting owner approval (2026-11-17).**

## Purpose
- Admin console still speaks v4/tiers ("plan_tier" badges, free-plan page). Show the **current v5 plans** and give one page per firm with everything needed to support it.

## Architecture
- **Overview (AdminDashboardView):**
    - plan mix by v5 plan (Advocate / Chambers / Firm / Enterprise·custom / free-launch);
    - MRR ex-GST + ARR; plans ending in 7 days; sign-ups stuck before payment;
    - AI spend card (from `admin-ai-spend-guard`).
- **Firms list:** plan name (`selected_plan` → v5 label), seats used/cap, credits left, renews on, status; filters by plan / ending soon / unpaid.
- **Firm 360 (FirmDetailView) tabs:**
    - Plan — current plan, period, seats, Munshi seats, credit allowance; actions: extend period (no charge, audited, reason required), change seats, custom plan (see `admin-custom-plan`), suspend/reactivate;
    - Credits — balance, grants with expiry, ledger (who spent what, per feature), add credits;
    - Members — users, roles, last active, per-user credits + cap (see `admin-per-user-usage`), reset password, sign in as user (existing impersonate);
    - Payments — billing events, invoices (PDF), manual payments;
    - AI — tokens/₹ by feature and user, firm AI pause.
- **Free plan page:** renamed "Free launch" and kept only for accounts that still have it (memory: sign-up is paid-only).
- Mostly read endpoints composing existing services: `GET /admin/firms/:id/overview` (one round trip), `GET /admin/firms/:id/ledger?cursor=`.

## Impact map
- `services/admin.service.ts` (`listFirms`, `getFirm`, `platformStats`): add plan/seat/credit fields; keep queries bounded.
- `lib/plans.ts`: labels only, no price changes.
- Web admin views: FirmsView, FirmDetailView, AdminDashboardView, FreePlanView, api.ts/queries.ts.
- Design: Chambers black & white, light + dark; red only for a mandatory issue.
- Impersonation: existing, unchanged.

## Edge cases
- Firm with no owner user / deleted users → "—", no crash.
- Legacy v4 `selected_plan` ids → mapped label + "(v4)".
- Big ledgers → paginated (50 a page).
- Extend period on a suspended firm → refused with message.

## Acceptance criteria
1. Overview plan mix and MRR match a SQL count on the same data.
2. Firms list shows v5 plan names and can filter "ending in 7 days".
3. Firm 360 shows plan, credits, members, payments, AI on one page; each action works and is audited.
4. Works at phone width and in dark mode.
