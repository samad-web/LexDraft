# Feature: Pricing v2 (draft limits, Chamber per-seat, GST, India benchmark)

Status: **phase A built 2026-11-11** (approved by the user the same day; migration 0104, not yet applied on prod). Deferred from phase A: the composer meter (DraftBotModal had other uncommitted work) and drafts-used in Admin users. Commercial basis: [market/pricing-plan-v2.md](../market/pricing-plan-v2.md). Benchmark: [market/pricing-benchmark-india.md](../market/pricing-benchmark-india.md).

## Purpose
- Replace "unlimited drafting" with published monthly draft limits, so each plan stays profitable on Sonnet 5.5. My estimate is ₹8–20 per draft, still to be confirmed from /admin AI cost.
- Change Practice (₹4,999 flat for 8 seats) to **Chamber**: ₹2,999 for 2 advocates, plus ₹899 per extra advocate. ₹2,399 and ₹719 on yearly billing.
- State GST clearly. Solo and Student prices include GST; Chamber prices are +GST.
- Later phases: Student plan, clerk seat, draft packs, storage add-on, Free Diary after 1 Jun 2027, founder offer.

## What already exists (reuse, don't rebuild)
- `services/ai-quota.service.ts`: a per-user monthly cap counted in `ai_generations`. The cap comes from `plan_ai_caps` (0045: Solo 20, Practice 200, Firm 1000). The cycle runs from `firms.renews_at`, or the calendar month when that is empty. Over the cap, the API returns 429 `ai_quota_exceeded`.
- `lib/free-plan.ts`: `FREE_AI_MONTHLY_CAP = 1_000_000` (unlimited) and `FREE_STORAGE_LIMIT_BYTES`. The storage limit only applies to free accounts (`storage-usage.service.ts`).
- `services/billing.service.ts`: `PAID`, `billingPlans()`, Dodo checkout and webhook (the webhook is the only thing that changes a plan). Web mirror: `components/PlanCards.tsx` (`SIGNUP_PLANS`).
- Seats: `firms.seats` and `firm_seat_floor()` (0046: Practice 8). They are enforced in `invitations.service.ts` (`assertSeatCapNotExceeded`, 402 `seat_cap_exceeded`).
- Roles: `Legal Secretary` (0009) has drafting.basic and templates but no AI drafting. It becomes the clerk seat in phase B.
- Dodo supports seat add-ons on a subscription (`product_cart[].addons[{addon_id, quantity}]`, and `changePlan` with the new total) and `price.tax_inclusive`.

## Bug found during design (fix in phase A)
**Drafts made through intake are never counted.** The intake endpoints (`/engine/intake/*`, the main way drafts are made) and the orchestrator, revise, review, ask and research services all call `assertCanGenerate`, but only `/generate`, `/generate/stream`, `/agent/stream` and title reports call `record()`. The usage count is therefore close to zero, and today's cap does nothing for most drafting.

## Decisions taken in this design
- **What counts as a draft:** one completed document. That is one `ai_generations` row per draft produced by intake, generate, stream, agent, firm-format generate or a title report. Redraft, review, ask, extract, research and diary-assistant are **not counted**: they stay under fair use and are already throttled per hour by `llmGenerationLimiter`. Advocates understand "50 drafts"; they don't understand tokens.
- **Limits are per advocate, not shared across the team.** This keeps the per-user model that already exists, so no team-wide counting has to be built. It also stops one person using up the whole chamber's allowance. (This changes "shared" in pricing-plan-v2.)
- **Plan IDs stay as they are.** Internally it is still `practice` / `Practice`, and only the label shown to users becomes "Chamber". This follows the "lowercase keys kept" convention and avoids touching `plan === 'Practice'` checks across the code.
- **No live paying customers yet:** the Dodo keys are pending. Changing prices and limits therefore affects free and trial accounts only.

## Architecture by phase
### Phase A — before payments go live (this build)
1. **Count intake drafts.** Call `aiQuotaService.record(firmId, userId, 'generate', { docType, draftId })` once, when an intake session produces its document. Recording is idempotent per `draft_id`, so editing or re-rendering the same draft is not counted again; a new draft is.
2. **New limits.** A migration updates `plan_ai_caps`: Solo 50, Practice 40, Firm 1000 (unchanged). `FREE_AI_MONTHLY_CAP` becomes 30. Write the migration so it can be re-run safely.
3. **Chamber price and seats:**
   - `PAID.practice` becomes ₹2,999 / ₹2,399 a month, with a new `CHAMBER_SEAT` add-on at ₹899 / ₹719.
   - Checkout takes `seats` (2–8) and sends the seat add-on with quantity `seats − 2`.
   - The webhook sets `firms.seats = 2 + add-on quantity`.
   - `firm_seat_floor('Practice')` changes from 8 to 2 (migration). Existing firms keep their seat count, because the floor only ever raises seats.
4. **Usage meter.** The Plan & Billing page and the composer show "12 of 50 drafts used · resets 1 Dec", read from `aiQuotaService.status`. At 80% the user sees a soft notice. At the limit, the 429 error says: "Drafting limit reached — renews on <date>. Upgrade for more."
5. **GST.** The Dodo products for Solo and Student are set `tax_inclusive: true` (done by you in the dashboard). Chamber is tax-exclusive. Plan cards show "incl. GST" or "+18% GST".
6. **Copy.** `billingPlans()` and `SIGNUP_PLANS` get the new names, prices, limits and seat picker, kept in sync between the two. The Android app still shows no purchase UI (decision of 2026-11-03).

### Phase B — after phase A is live
- **Student plan** at ₹149 / ₹99 a month, with 15 drafts. Students are identified by `users.account_type = 'student'` plus their college name; an admin can revoke the plan.
- **Clerk seat** at ₹299 / ₹249 a month: a new `firms.clerk_seats` column and the Legal Secretary role. Clerks don't count against advocate seats.
- **Draft pack** at ₹299 for 25 drafts: a one-time Dodo product and a new `firm_draft_credits` table (firm, drafts, expires_at). Pack drafts are used only after the monthly limit runs out.
- **Storage limits for paid plans** (Solo 10 GB, Chamber 25 GB) plus a storage add-on at ₹199 per 25 GB. There is no compression, as you decided.

### Phase C — before 1 Jun 2027
- **Free Diary.** A free account that expires moves to free-diary limits (5 drafts, 25 synced cases, 500 MB) instead of the 402 renew wall.
- **Founder offer**, using a Dodo discount code: Solo yearly at ₹999 a month, locked for 2 years, for accounts that pay before 1 Jun 2027.

## Impact map (phase A)
| Touches | Change | What could break |
|---|---|---|
| `routes/drafting.routes.ts`, `services/intake.service.ts` | Record one generation when intake produces a draft | Counting twice on re-render or edit, which is why recording is per `draft_id`. A failed record is logged and the draft still succeeds, as today |
| `services/ai-quota.service.ts` | Idempotent `record`; status is read by the meter | Existing quota tests |
| New migration (0104) | `plan_ai_caps` values; `firm_seat_floor` Practice 8 → 2 | A live data change, **needs your approval** on Supabase and prod. Existing Practice firms keep 8 seats |
| `lib/free-plan.ts` | `FREE_AI_MONTHLY_CAP` 30 | Heavy free users now hit a limit; a notice is needed |
| `services/billing.service.ts` | PAID prices, seat add-on in checkout and webhook, seat count | Webhook tests; an unknown add-on ID must be logged and must not wipe the seat count |
| `components/PlanCards.tsx`, the billing view, the composer | Prices, seat picker, meter, GST label | Sign-up flow (plan → WhatsApp → Google) and the native-app "hide purchase" check |
| `invitations.service.ts` | No code change; the floor now comes from the webhook | Reducing seats below active users (see edge cases) |
| Env and Dodo dashboard | New `DODO_ADDON_CHAMBER_SEAT_{MONTHLY,ANNUAL}`; products repriced; tax_inclusive set | Without them, checkout returns 503 `payments_disabled` as today |
| Admin (`/admin/users`, the firm detail page) | Show drafts used and the limit | Display only |

## Edge cases and failure modes
- **Two drafts started at the same moment** can both pass the check and go 1 over the limit. That is accepted and documented, not locked.
- **Recording fails** after the draft succeeds: log it and don't fail the user, as the current code does.
- **Cycle start:** a firm without `renews_at` (free or trial) uses the calendar month. A paid firm's cycle follows its Dodo renewal date.
- **A firm drops to fewer seats than it has active advocates:** checkout refuses with a message to remove members first. The webhook never deactivates users.
- **Upgrade in the middle of a cycle** (Solo → Chamber): the new limit applies straight away, and drafts already made still count.
- **Plan on hold or past due:** follows today's behaviour and is not changed here.
- **A deleted draft still counts** (the existing tombstone rule).
- **Security:** the seat number from the client is validated as an integer from 2 to 8, and the webhook only trusts Dodo's add-on quantity. Only the owner can buy, as today.

## Acceptance criteria (phase A)
1. A completed intake draft adds exactly 1 to usage, and editing or re-rendering it adds 0.
2. A Solo user at 50 drafts gets a 429 `ai_quota_exceeded` showing the renewal date, and draft #51 is refused.
3. A free launch user's limit is 30. Diary and eCourts are unaffected.
4. Redraft, review, ask and research don't change the draft count.
5. Chamber checkout with seats = 5 sends an add-on quantity of 3, and the webhook sets `firms.seats = 5`.
6. Seat values of 1, 9 and non-integers are rejected with 400.
7. A Practice firm that already has 8 seats still has 8 after the migration.
8. The plan cards show the new prices with "incl. GST" or "+18% GST". Web and API plan lists match (test).
9. The meter shows used of limit and the reset date, and the 80% notice appears.
10. The Android app shows the meter but no buy buttons.
