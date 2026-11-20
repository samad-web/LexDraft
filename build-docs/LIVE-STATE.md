# Live state — built but not live (live-state-audit, 2026-11-20)

Owner marks each row **ship / cut / park**. "Rec." = my recommendation. Checked on prod 2026-11-20 (read-only).

| # | Item | Where | Prod state | Rec. | Owner |
|---|---|---|---|---|---|
| 1 | Judgments corpus + search | 0098/0099, dbc14d2, `judgments.service.ts` | Tables absent; `JUDGMENTS_SEARCH` unset (defaults on, harmless: missing table = "not configured") | Ship (Stage 1, approved) | ship |
| 2 | Embedding service (semantic search for laws, matter docs, judgments) | `EMBED_SERVICE_URL` | **Not set on prod** → keyword search only | Park until a bigger box; keyword search for Stage 1 | |
| 3 | Laws DB for Research | `LAWS_DATABASE_URL` | **Not set on prod** — check what Research shows live | Check in Stage 1 | |
| 4 | Bar Council verification | 0102/0103, 6eb59ca | Off at sign-up, code kept | Park (or cut if never) | |
| 5 | eFiling | `efiling-*` routes | "Soon" | Park — first to re-enable (Stage 4) | |
| 6 | Clause Bank, Matter Intel, Title Reports, Mock Arguments | routes + views | "Soon" | Park; cut any with no demand by Stage 4 | |
| 7 | Android app | apps/web/android | Parked | Park | |
| 8 | E2E UI suite | 2433b8b | In repo, not in deploy steps | Ship: run before every deploy | |
| 9 | Pay-before-app | ac6c6c1 (local branch `fix/pay-before-app`) | **Not on origin/main** — other session's work | Owner: push + deploy, or drop | |
| 10 | OneDrive folder: 33 held-back files + old uncommitted work | OneDrive LEXDRAFT | Not in git | Triage once; then stop using that folder for code | |
| 11 | Failing tests on main | migrations idempotency at 0042; auth "role=group" tier | Known | Fix (owner: which tier does role=group get?) | |
| 12 | Co-counsel guests' free launch to 1 Jun 2027 | signup-hardening open item | — | Owner decides | |

Resolved while auditing: uncommitted engine changes in difai-wt-local (cause_title, _court, s138) are identical to origin/main — nothing to do.
