# Feature: Razorpay billing (replaces Dodo Payments)

Status: **built; test-mode payment verified 2026-11-13 (Chamber 3 seats activated by webhook)** (approved 2026-11-13). Owner decision: quit Dodo Payments, move to Razorpay. Prices are unchanged (current Solo / Chamber catalogue in `billing.service.ts`); v4 prices go in once confirmed. Migration 0105 applied locally only.

## Purpose
- Take subscription and top-up payments through Razorpay instead of Dodo.
- Dodo never went live (test mode only), so there are no live subscribers to migrate.

## Key difference: Razorpay is NOT a Merchant of Record
| | Dodo (MoR) | Razorpay (gateway) |
|---|---|---|
| Who sells to the advocate | Dodo | **DifAi / Sirah Digital** |
| GST on our price | Dodo charged, remitted, invoiced | **We charge it, issue the tax invoice with our GSTIN, file GST returns** |
| Fee | 4% + ≈₹13 per payment, US$1 per refund | ≈2% + 18% GST on the fee (2.36%), no fixed fee; refunds free of extra fee |
| Firm's input tax credit | depended on Dodo invoice | our own GST invoice with the buyer's GSTIN, so it works |
- Margin effect (v4 prices): fees fall from ₹21 to ₹4.70 on Sanad and from ₹29 to ₹9.40 on Vakalat. Entry-plan profit rises from about 21% to about 27–31% (Sanad 30.5%, Vakalat 27.0%).
- **Owner must confirm:** that Sirah Digital is GST-registered (GSTIN), and that a GST tax invoice is generated per payment (Razorpay Invoices, or our own PDF). If not registered, prices carry no GST and nothing can be claimed.

## Architecture
- **Products (as built):** no plan ids in env. Each (plan, cycle, advocates, amount) becomes a Razorpay Plan the first time it is bought, stored in `razorpay_plans`. A price change makes a new plan, because Razorpay plans can't be edited. The webhook maps `plan_id` back to plan, cycle and seats, so seats always come from what Razorpay charged. The current "2 advocates + ₹899 per extra" works as-is. (The v4 "₹649 × quantity" idea is no longer needed.)
- **GST:** plans shown "+18% GST" (Chamber) are charged ×1.18; GST-inclusive plans (Solo) are charged as shown. Whether invoices come from Razorpay Invoices or our own PDF is still open (needs the GSTIN answer).
- **Subscriptions:** server calls `POST /v1/subscriptions` (plan_id, total_count 120 monthly / 10 yearly, notes{firm_id, user_id, plan, cycle, seats}). `checkoutUrl` = `/api/billing/pay/:subscriptionId`, a small API page that opens Razorpay Checkout (redirect mode, `callback_url` = `/api/billing/callback`). This means the web, onboarding and renew flows are unchanged.
- **Brief Packs** (and any one-time charge): `POST /v1/orders`, then Checkout. Credits are granted only by the verified webhook (`payment.captured` / `order.paid`).
- **Webhook** `/api/billing/razorpay/webhook`:
    - Verifies `X-Razorpay-Signature` as an HMAC-SHA256 of the raw body with the webhook secret, compared in constant time.
    - Is idempotent on the `x-razorpay-event-id` header in `billing_events`.
    - Events handled: `subscription.activated`, `subscription.charged` (first payment and renewals: tell them apart by `paid_count`), `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `payment.failed`, `order.paid`, `refund.processed`.
- **Checkout return:** the Checkout handler's `razorpay_signature` (an HMAC of `order_id|payment_id` or `payment_id|subscription_id`) is verified server-side for an instant "Payment received". The plan is still changed only by the webhook.
- **Plan change (as built):** a paying firm gets a NEW subscription with `start_at` = its current renewal date and `notes.replaces` = the old id. On `subscription.authenticated` the old one is cancelled at cycle end. This works for UPI Autopay too (an in-place update is card-only), and nobody pays twice. The new plan, and its seats, apply from the renewal date.
- **Data:**
    - Migration (additive): `firms.razorpay_customer_id`, `firms.razorpay_subscription_id`, `billing_events.provider` (default 'razorpay').
    - Dodo columns stay unused, and are dropped later with approval.
- **Env:** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. All `DODO_*` are removed. Keys live in `.env` only, never in git or chat.
- **Keep from the Dodo build:**
    - the plan/seat validation (`seats_below_members`: Solo/Vakalat refused for a firm with members);
    - the renewal de-duplication on the first charge;
    - the admin billing views.
    These were the uncommitted test-run fixes; they are folded in here, not committed as Dodo code.

## Impact map
| Area | Files | What could break |
|---|---|---|
| API billing | `billing.service.ts`, `billing.routes.ts`, `routes/index.ts` (raw-body webhook), `env.ts` | checkout, webhook auth, plan activation |
| Onboarding | `onboarding.service.ts` | plan-first sign-up handoff to checkout |
| DB | new migration 0105 (additive), `0096_billing_dodo.sql` untouched | none to existing data |
| Types | `packages/types` `BillingPlan`, `BillingCheckoutRequest` (quantity) | web/API contract |
| Web | `useBilling.ts`, `views/BillingView.tsx`, `views/AuthView.tsx` (renew), `admin/views/BillingView.tsx`, `index.html` (Razorpay checkout.js script) | pay button, seat picker, admin billing |
| Legal pages | `views/LegalView.tsx` (processor named "Dodo Payments") | privacy/terms accuracy (Razorpay's website-compliance check reads these) |
| AI credits feature | `features/ai-credits.md` (other session, awaiting approval) | Brief Pack purchase must call the Razorpay order flow, and credits are granted from `order.paid` |
| Tests | `billing.test.ts`, `pricing-v2.test.ts`, `__tests__/setup.ts`, `e2e/support/fixtures.ts` | Dodo mocks replaced by Razorpay mocks |
| Docs | `MEMORY.md`, `PLAN.md`, `TESTING.md`, `CHANGELOG.md`, `pricing-v2.md` | |

## Edge cases and failure modes
- **Two paid checkouts (found in testing):** the newest subscription wins and the other is cancelled at once; its payment is refunded from the dashboard. A late retry for the older one is ignored.
- **Webhook secret:** it must be set when the webhook is created. Events created without one stay unsigned on every retry.
- **Forged or replayed webhooks:** bad signature → 401. A duplicate event id → 200 with no effect.
- **Webhook before the Checkout return, or Checkout return without a webhook:** only the webhook changes the plan. The page polls `GET /billing` until it does, with a "Payment received, activating…" state.
- **UPI Autopay:**
    - Debits need pre-debit notice, and can take up to 48h. While charging, the subscription status is `pending`; we keep access during a grace period.
    - Mandates above about ₹15,000 (Brief yearly ₹16,490, Associates yearly) need card or bank authorisation per debit. Show "pay yearly by card or netbanking" for those.
- **Failed renewal:** `subscription.halted` → plan `past_due`. AI pauses, the diary keeps working, and the user is notified.
- **Downgrade or plan change mid-cycle:** applied at cycle end by default, so there are no refunds to compute.
- **Refunds:** issued manually from the Razorpay dashboard. `refund.processed` logs the event; the plan is not auto-revoked unless the subscription is cancelled.
- **Seats:** quantity must be ≥ the firm's active members plus pending invites. If not, the request is refused before Razorpay is called.
- **No keys configured:** `paymentsEnabled=false` and the buy buttons are hidden, as today.
- **Test mode on prod:** forbidden, because `rzp_test_` keys in production let anyone unlock a plan. With `NODE_ENV=production`, test keys are ignored (payments off, error logged).

## Acceptance criteria
1. A new user can buy each plan, monthly and yearly, in Razorpay test mode. The webhook sets the plan, cycle, quantity, `renews_at` and Razorpay ids; one `billing_events` row per event.
2. A forged signature → 401. A replayed event id → no second effect.
3. The first charge is logged once; a later `subscription.charged` is logged as a renewal.
4. Associates with quantity 3 sets seats = 3. Quantity below members → 400 `seats_below_members`.
5. Plan change Vakalat → Brief updates the same subscription, with no second subscription.
6. A Brief Pack order grants credits only after `order.paid` (once credits exist), never from the browser callback alone.
7. `subscription.halted` → past_due, and AI is blocked while non-AI features keep working.
8. No `DODO_` reference remains in code or env examples. The legal pages name Razorpay.
9. Production ignores `rzp_test_` keys: payments stay off and an error is logged. The API still starts, so the site stays up.

## Build order
1. Migration + env + webhook (verification, idempotency) + tests.
2. Subscriptions checkout + web Checkout.
3. Plan change + seats.
4. Orders for Brief Packs (with the AI-credits feature).
5. Legal pages, admin views, Dodo removal.
6. Full test-mode run with the owner paying (UPI `success@razorpay`, test cards).

## Needed from the owner before building
- A Razorpay account with KYC done, and **test-mode** Key ID + Key Secret saved in `apps/api/.env` as `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (don't paste them in chat).
- GST registration status (GSTIN) and how invoices should be issued.
- Approval of this design.
