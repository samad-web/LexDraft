# Feature: Credits, not pages — stop and ask to pay when credits run out

Status: **LIVE 2026-11-17 (6adc078).** WhatsApp template `difai_credits_low` Meta-approved and switched on. Note: per-user DifAi caps are never absorbed (402 user_cap_reached).

## Owner decisions (2026-11-17)
- Drafts stay **size-based** (1 credit ≈ 400 words, rounded up to ½), but advocates only ever see **credits** — never "pages", never a draft cut into locked pages.
- When credits are not enough: **stop before drafting**, nothing drafted or charged, and a "Credits over — buy credits to continue" screen with the Brief Packs / Pay. (Android app: no payment wording, per Play policy — the existing native copy.)
- A finished draft that comes out bigger than the credits left is **delivered whole**; the balance goes to **0** and DifAi absorbs the small difference.
- Early warnings: **in-app banner + bell** at ≤ 20% of the month's credits and at 0, with "Buy credits"; and **WhatsApp** to the owner at the same two points (new Utility template).

## Architecture
- **Estimate before drafting** (`creditService.draftEstimate(docLabel?)`): median credits of the last 50 finished drafts of that document type (intake drafts are keyed `intake:<matter>:<docLabel>`), else of all drafts, else **2**; never below 1. Every drafting entry point that today checks "at least 1 credit" checks the estimate instead → 402 `credits_exhausted` (existing popup) before any AI call.
- **No more locks** (`creditService.meterDraft`): a *new* draft takes what the pool holds and is marked fully paid; the shortfall is logged as absorbed (`credit_ledger.meta.absorbed`) — only when the pool had at least half of what the draft needed (otherwise 402, so a 0.5-credit balance can't buy a free plaint through a path without a pre-check). A *re-render that grows* an existing draft with too few credits → 402, the draft stays as it was. Old locked drafts can still be unlocked (unchanged path).
- Wording: "page" removed from credit messages (lock notice no longer produced; billing/credit copy says credits).
- **Low-balance warnings** (`credit-alerts.service`): after each charge, if the pool crossed ≤ 20% of the month's allowance or reached 0 → bell notice to owner/admins + WhatsApp (template `difai_credits_low`), once per threshold per plan month (dedupe key `credits:<firm>:<cycle>:<20|0>`). App banner reads the balance already on the client (`useCredits`).

## Impact map
- `credit.service.ts` (meterDraft, new draftEstimate), `draft-meter.service.ts` (lock paths become dead for new drafts), `drafting.routes.ts` (7 pre-checks), `notifications`, `whatsapp.service` (template), web `Sidebar`/banner, `CapExceededModal` copy, `LockedDraftCard` (kept for old locks).
- Margin: absorbed credits cost ≈ ₹2.5 each in AI; bounded by the estimate and the half-balance rule.

## Acceptance criteria
1. Not enough credits for the estimate → 402 before drafting, nothing charged, popup offers Brief Packs / plans (web) or neutral copy (app).
2. A new draft bigger than the balance → delivered whole, balance 0, no lock, absorbed amount logged.
3. Pool below half of a new draft's need → 402, nothing charged, no draft returned.
4. Growing re-render without credits → 402; the existing draft unchanged.
5. Crossing 20% and reaching 0 → one bell notice + one WhatsApp each per plan month; not repeated.
6. No "page" wording in credit messages.
