# Paid-only sign-up gate (2026-11-16)

## Purpose
Owner decision: sign-up is paid-only. Before this fix the "pick a plan and pay" step (/onboarding) was enforced only in the browser. A new Solo firm is created as a free-launch trial until 1 Jun 2027, so a crafted request (or a sign-up that named a plan, which skipped onboarding) got the whole app plus 25 AI credits a month free. "Book a demo" also created a real 14-day account.

## Architecture
- `plan-status.service`: PlanState gains `onboarded` (`users.onboarded_at is not null`).
- `requireActivePlan`: firm user not onboarded -> 403 `onboarding_required` (403, not 402: 402 signs the web user out). Superadmin / act-as bypass unchanged.
- `authService.googleSignUp`: always sets `onboarded_at = null` (a `plan` only pre-selects the plan); intent is always `trial` (never `paid` = active without payment); `intent: 'demo'` -> 403 `demo_disabled`, nothing created.
- Web: SignupView demo chooser offers only "Talk to our team" and "Book a guided demo" (contact form, no account). Landing button "Begin trial" -> "Get started"; sign-up button "Create account".

## Impact map
- All feature routes behind requireActivePlan (routes/index.ts). Not gated (by design): /auth, /onboarding, /billing, /notifications, /invitations accept.
- Onboarding page uses only /onboarding + /billing, so it still works.
- Invited members, admin-created users, existing accounts: `onboarded_at` defaults to now(), unaffected.
- Password `/auth/sign-up` stays off in production (PASSWORD_SIGNUP unset); it is a dev/test path.

## Edge cases
- Pre-onboarding user signs in later: completeSignIn plan check still passes (trial not expired), web routes them to /onboarding; API routes 403 until done.
- DB error in the gate: allowed through (existing fail-open rule).

## Acceptance criteria
1. Not-onboarded account -> 403 onboarding_required on app routes, even on a free-launch-style firm.
2. Onboarded account in order -> passes.
3. Google sign-up naming a plan (+ intent paid) still needs onboarding; firm stays `trial`.
4. Demo sign-up -> 403 demo_disabled, no user created.
