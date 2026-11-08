# Redraft without AI (exact edits)

**Purpose:** an advocate's exact correction ("change 10.11.2026 to 15.11.2026") should not spend an AI call or wait for one.

**Architecture:** `apps/api/src/lib/draft-local-edit.ts` `localEdit(instruction, paragraphs)` returns paragraph edits, or null. `draftReviseService.revise` tries it first; null goes to the AI as before. Output is the same `ReviseResult`, so the advocate still sees before/after and accepts or discards. `/revise` skips the hourly AI limiter for these.

**Understood:** change/replace/correct/update/substitute/modify X to/with/by/as Y; "from X to Y"; "instead of X put Y"; "X is wrong, it should be Y"; "... should be Y instead of X"; "X should be Y"; delete/remove para N, "para N delete", "remove 2nd para"; add para after N: text.

**Safety:** X and Y must be exact (quoted, contain a digit, or a proper name) and X must be in the draft; a date matches any of . / - and an amount with or without commas, never inside a longer number. "Para N" is the printed number and must be unique. An amount or date change warns to check the amount in words and anything computed from it. AI-review fixes (`source: 'review'`) never qualify.

**Impact:** `/drafting/revise` only. No schema change.

**Edge cases:** X not found, ambiguous para number, rewrites ("make the grounds stronger"), or no old value ("change the date to ...") -> null -> AI. Numbers are not renumbered after delete/insert (warned).

**Acceptance:** tests in `lib/__tests__/draft-local-edit.test.ts` and `services/__tests__/draft-revise.local.test.ts`: no model call, no quota, review fixes excluded.
