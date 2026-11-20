# live-state-audit (Stage 0) — BUILT 2026-11-20

## Purpose
Built-but-not-live work costs upkeep and hides risk. One list, one decision each.

## Architecture
- Doc only: table in `build-docs/LIVE-STATE.md` — item, commit, migration, prod state, owner decision (ship/cut/park), date.
- Items known now: judgments corpus (0098/0099, off); Bar Council at sign-up (off 6eb59ca); eFiling, Clause Bank, Matter Intel, Title Reports, Mock Arguments ("Soon"); E2E suite (2433b8b, not in deploy flow); Android (parked); OneDrive's 33 held-back files; uncommitted engine changes in difai-wt-local (cause_title, _court, s138 pipeline + tests).
- "Cut" = remove code + routes in its own commit; "park" = stays behind its switch with a review date.

## Impact map
- Cutting a feature touches its routes in `apps/api/src/routes/*`, its views, nav entries, plan feature lists (pricing cards list built features only). Migrations stay (additive; never dropped on prod without a go).

## Edge cases
- A "Soon" feature holding users' data → park, never cut.
- OneDrive files that hold the account email → never committed.

## Acceptance criteria
- Every item has an owner decision and date in LIVE-STATE.md.
- Cut items: removed, tests green, nothing in nav or pricing cards points to them.
