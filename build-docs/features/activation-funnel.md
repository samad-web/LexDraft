# activation-funnel (Stage 0) — BUILT 2026-11-20

## Purpose
Know where new advocates drop off, so the next stage fixes the real gap.

## Architecture
- Admin console tile (`/admin`, owner only): weekly cohorts → signed up, paid, first draft, active in week 2 (≥1 draft or case action), renewed.
- Computed by read-only SQL over existing tables (users/firms, billing orders, drafts, activity). No tracking script, no third-party analytics.
- Check `analytics.service.ts` and admin routes first; extend, don't duplicate.

## Impact map
- `admin.routes.ts`, admin console views, read-only queries on billing + drafts tables. No writes; no migration expected (an index only if a query is slow, with owner's go).

## Edge cases
- Exclude owner-allowed test accounts (test@, ananth@).
- Multi-seat firms: count per firm and per user.
- Empty cohort → 0, not an error.

## Acceptance criteria
- Tile shows the 5 steps for the last 8 weekly cohorts; numbers match a hand-run SQL check.
- Owner-only (403 for anyone else); test accounts excluded.
