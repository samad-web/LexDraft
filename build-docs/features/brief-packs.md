# Feature: Brief Packs (one-time AI credit top-ups)

Status: **built 2026-11-14** (approved 2026-11-14). The owner chose to ship Brief Packs in the AI-credits release. Prices are the v4 DRAFT, **not final**, and live in one config.

## Purpose
- When the month's credits run out, an advocate can buy more now instead of upgrading or waiting.
- Without packs, a locked draft can only be unlocked by a plan upgrade, and free-launch accounts can't unlock at all.

## Packs (GST-inclusive, valid 12 months, any active account)
| Pack | Price | Credits |
|---|---|---|
| `pack_25` | ₹499 | 25 |
| `pack_60` | ₹999 | 60 |
| `pack_130` | ₹1,999 | 130 |
| `pack_330` | ₹4,999 | 330 |

- One config: `BRIEF_PACKS` in `lib/plans.ts`, mirrored in web.
- Pack credits are spent **after** the month's plan credits (spends go soonest expiry first; already built).

## Architecture (reuses the Razorpay + invoice code)
- **Buy:** `POST /api/billing/packs/checkout {pack}`, owner only, like plans.
    - Creates a Razorpay **Order** (one-time payment, not a subscription) for the pack price.
    - `notes` carry `firm_id`, `user_id`, `pack`.
    - Logged as `checkout_started`.
- **Pay page:** `/api/billing/pack-pay/:orderId` opens checkout.js with `order_id` (redirect mode), same as the plan pay page.
- **Return:** `/api/billing/callback` also accepts an order return. It checks the signature (HMAC of `order_id|payment_id`) and goes to `/app/billing?pack=done`.
- **Credits are granted only by the webhook:** `payment.captured` with `notes.pack`.
    - The amount must equal the pack price, else nothing is granted and an error is logged.
    - Grant: `credit_grants` with `source='topup'`, `ref='topup:<payment id>'` (unique, so a redelivery is a no-op), expiring 12 months later.
    - **GST invoice:** "DifAi Brief Pack (60 credits)", same numbering and tax split.
    - Event logged as `pack_bought`.
- **Migration 0109 (additive):** only adds `pack_bought` to the `billing_events.kind` check. Grants and invoices reuse their columns: invoice `plan` = pack id, `cycle` = 'one-time', `seats` = 0.
- **Web:**
    - "Brief Packs" on Plan & Billing, under the credit meter.
    - The locked-draft card and the credits sheet link to it.
    - **Android: hidden** (no purchase UI in the app).

## Owner steps
- In the Razorpay webhook settings, also tick **`payment.captured`** (test now, live at deploy).

## Impact map
| Area | Files | Risk |
|---|---|---|
| Payments | `billing.service.ts` (order, pay page, callback, webhook case), `billing.routes.ts` | Granting without payment: credits only from the signed webhook, after an amount check |
| Credits | `credit.service.addGrant` (exists) | Double grant: unique ref |
| Invoices | `subscription-invoice.service.ts` description | A wrong line: tested |
| Web | `BillingView.tsx`, `LockedDraftCard.tsx`, `CapExceededModal.tsx` | Android purchase rule |
| Types / config | `lib/plans.ts`, web mirror | Price mismatch: mirror test |

## Edge cases
- **Webhook twice / retry:** one grant, one invoice.
- **Amount tampered or unknown pack:** no grant, logged.
- **Payment failed or cancelled:** nothing granted; "Payment cancelled" banner.
- **Refund:** issued from the Razorpay dashboard. Credits are **not** taken back automatically, so the admin removes them by hand (manual credit note, same as plans).
- **Cancelled or expired plan:** pack credits stay usable until they expire, but the app itself needs an active plan to sign in.
- **Non-owner:** 403.

## Acceptance criteria
1. Each pack creates a Razorpay order for exactly its price; non-owners get 403; with no keys, 503.
2. A signed `payment.captured` for a pack grants exactly its credits once, valid 12 months, and issues one GST invoice.
3. A wrong amount or an unknown pack grants nothing.
4. Pack credits are spent after the month's plan credits.
5. Web shows the packs on Plan & Billing (hidden on Android); web and API pack lists match.

## As built (2026-11-14)
- **Shared plumbing:** the plan pay page and callback serve both kinds. `/api/billing/pay/:id` takes `sub_…` or `order_…`. The callback checks HMAC(`order_id|payment_id`) for orders and goes to `?checkout=pack-done`.
- **Webhook:** pack id, firm and amount are read from **our own order** (`GET /orders/:id`), never from the payment. Subscription payments also send `payment.captured`; their orders carry no pack, so they are ignored.
- **Web:** the packs come from `/api/billing` (`packs`), so there is no second list to keep in step. The card shows the price per page. Android shows no packs.
- Migration 0109 applied locally only.
