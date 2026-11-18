# Pay before app (2026-11-18, owner)

## Purpose
Closing Razorpay after onboarding sent the owner to the dashboard (30-minute unpaid window). Owner: the dashboard opens only after payment.

## Architecture
- API onboarding.service.complete: for a paid plan, onboarded_at stays null; the payment webhook (billing.service applyPayment) sets it. requireActivePlan already answers 403 onboarding_required to not-onboarded users, so no feature route works unpaid.
- complete() can run again while unpaid (edit details / change plan); /billing/checkout opens a new payment.
- Web: App keeps ?checkout=… when sending a not-onboarded user to /onboarding. OnboardingView: checkout=done|paid -> "Confirming your payment…" (re-reads /me + /billing every 3 s); details saved + paid plan + not subscribed -> "Finish your payment" (Pay ₹X, Change plan or edit details).

## Impact map
- Replaces the 30-minute unpaid window (signup-flow tests updated). Free-launch / already-paid paths unchanged (onboarded_at set at once).
- Existing unpaid-but-onboarded accounts on prod keep the old behaviour until their window ends (then trial_expired renew flow). No data change.
- TrialBanner "payment not finished" no longer appears for new sign-ups.

## Edge cases
- Payment succeeds but webhook is slow (UPI): Confirming screen keeps polling; after 60 s says it can take minutes; signing in later works.
- Two orders paid (old order paid late + new one): existing duplicate handling applies (late payment still activates).
- checkoutError at onboarding -> /app/billing -> back to Finish payment.

## Acceptance criteria
- AC1 after onboarding unpaid: API 403 onboarding_required, needsOnboarding true.
- AC2 Razorpay dismiss URL and /app/dashboard lead to Finish payment; Pay opens checkout with the saved plan.
- AC3 return after paying shows Confirming, not the dashboard; app opens once the webhook lands.
- AC4 late payment of the first order still activates.

## ₹1 test code at onboarding (2026-11-18)
- "Have a code?" on the plan step and on Finish payment. Same rule as Plan & Billing: code = BILLING_TEST_COUPON and email on BILLING_TEST_EMAILS, else 400 invalid_coupon. At onboarding a wrong code is refused before anything is saved.
- Needed because pay-before-app keeps new accounts away from Plan & Billing until paid.
