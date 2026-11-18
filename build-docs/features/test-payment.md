# Test payment (simulated) — owner 2026-11-18

## Purpose
The owner tests logins and plans without paying. With the test code on an allow-listed account, "Pay" skips Razorpay and the plan switches on by itself after ~10 s.

## Architecture
- `billingService.startCheckout`: valid test code (`testCouponFor`: BILLING_TEST_COUPON + BILLING_TEST_EMAILS) → no Razorpay order; logs `checkout_started` at ₹0 with ref `test_<uuid>`; `setTimeout(TEST_PAYMENT_DELAY_MS = 10 s)` → `applyPlanPayment(..., simulated = true)`; returns `/app/billing?checkout=paid` (onboarding shows "Confirming your payment…", polls every 3 s).
- `applyPlanPayment(simulated)`: same plan logic (period, seats, onboarded_at, caches); amount 0, MRR 0, billing_events provider `test`; no GST invoice.
- `simulated` is a function argument set only by startCheckout — never from webhook/order notes.
- Brief Packs keep the ₹1 Razorpay test price (unchanged).

## Impact map
- billing.service (startCheckout, applyPlanPayment); onboarding.service.complete (calls startCheckout with the coupon); OnboardingView Confirming screen (no change); invoices (none issued); admin revenue (₹0 rows, provider test).

## Edge cases
- API restart within the 10 s: the timer is lost; plan not applied → owner presses Pay again.
- Wrong code / other email: 400 invalid_coupon, nothing saved (unchanged).
- A webhook with a ₹0 payment on a test-coupon order: refused (amount ≠ ₹1).
- Double apply: idempotent on the `test_<uuid>` ref.

## Acceptance criteria
- AC1 allow-listed + code → no Razorpay order, URL `?checkout=paid`.
- AC2 plan not active before 10 s; active at 10 s; MRR 0; provider test; no invoice.
- AC3 a webhook can never trigger the free path.
- AC4 through onboarding: app closed until the plan applies, then open; no invoice row.
