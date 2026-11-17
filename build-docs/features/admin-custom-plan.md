# Feature: Custom plan with manual payment + GST invoice (admin)

Status: **built 2026-11-17 (branch feat/admin-console-v2), not deployed.** As built: tier Firm + seats set in a second update (seat-floor trigger); payment modes upi / bank_transfer / cheque / cash; firm's own billing page counts an active custom plan as subscribed.

## Purpose
- Enterprise / special deals: the owner types the price and credits for a firm, records the offline payment, and DifAi issues the GST invoice — no Razorpay checkout.
- Today: `PATCH /admin/firms/:id/plan` sets tier/MRR/renewal/credit allowance by hand, with no payment record or invoice, and credit grants cap at 1,000 / 30 days.

## Architecture
- **Form (Firm 360 → Plan → "Custom plan"):**
    - plan name (free text, default "Enterprise");
    - advocate seats, Munshi seats;
    - credits per month (half steps, up to 100,000);
    - price **ex-GST** ₹ for the period; GST 18% and total shown live;
    - period: monthly / yearly / custom end date; start date (default today);
    - payment: mode (UPI / bank transfer / cheque / cash), reference no., date received.
- **Server `POST /admin/firms/:id/custom-plan`** (one transaction):
    - `firms`: `selected_plan='enterprise'`, `plan_tier='firm'`, `plan_status='active'`, `free_plan=false`, `seats`, `munshi_seats`, `credit_allowance`, `renews_at=end`, `billing_cycle`, `mrr_inr = price ÷ months`, `custom_plan_name`;
    - `billing_events` row: provider `'manual'`, `provider_ref = manual:<uuid>`, amount paise, mode + reference in payload;
    - then `subscriptionInvoiceService.issueForPayment` with `paymentId = manual:<uuid>`, `taxablePaise = price×100` (exact 18% match check kept).
- **Extra credits on demand:** the existing grant form gets amount up to 100,000, validity days, and an optional "paid ₹" field that also records a manual payment + invoice (same path, `plan: 'credits'`, cycle `one-time`).
- **Renewal:** existing 7-day reminder banner works off `renews_at`; owner renews by recording the next payment (same form, "Renew" prefilled).
- Migration 0114: `firms.custom_plan_name text null`. Invoice table column `razorpay_payment_id` reused for `manual:` ids (rename avoided: no data change).

## Impact map
- `services/billing.service.ts` (plan apply, MRR, adminSummary): MRR must include manual plans; v5 checkout must not overwrite a custom plan silently → owner's in-app "Plan & billing" shows "Custom plan — contact DifAi" instead of v5 checkout while active.
- `services/subscription-invoice.service.ts`: reused; invoice line shows custom plan name + period.
- `services/credit.service.ts` (`ensurePlanGrant` uses `credit_allowance`): already supports it — verify monthly reset on yearly custom plans.
- `lib/plans.ts` seats: seat enforcement must read `firms.seats` for enterprise (check `seat-enforcement`).
- `plan-status.service.ts` cache + permissions cache: invalidate after save.
- Admin BillingView: manual payments listed with mode/ref.

## Edge cases
- Price with paise that breaks the exact-18% check → validation forces whole rupees.
- Duplicate submit → idempotency key from the form (uuid generated client-side).
- Seller GSTIN not configured → plan saved, error shown "invoice not issued", retry button.
- Buyer GSTIN invalid → invoiced as unregistered (existing behaviour), warning shown.
- Custom plan over an active v5 plan → new period starts on the start date; confirm dialog states no refund/carry-over (manual-renewal rule).
- End date before start / 0 seats / negative price → 400.
- ₹0 complimentary plan → plan saved, no invoice, MRR 0, audited as complimentary.

## Acceptance criteria
1. Saving a custom plan sets the firm active with the typed seats, credits and end date; the firm sees that credit balance at once.
2. A GST invoice is issued with taxable = typed price, correct CGST/SGST vs IGST, and downloads from admin and from the firm's billing page.
3. MRR on Overview includes it (price ÷ months).
4. Double click creates one plan, one payment, one invoice.
5. Extra credits with "paid ₹" create a grant + invoice; without it, a grant only (audited).
6. Every action in the audit log.
