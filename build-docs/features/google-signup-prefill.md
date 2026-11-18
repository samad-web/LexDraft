# Google sign-up: name + email from Google (2026-11-18)

## Purpose
Owner: after "Sign up with Google", name and work email come from Google; only the WhatsApp number and password are typed.

## Architecture
- `apps/web/src/views/AuthView.tsx` only. The NUSI Create-account form now serves both paths.
- Google returns `signupRequired` → `googleSignup` set, `suName`/`suEmail` filled from `profile`; email is read-only, name stays editable (sent as `name`).
- START: Google path → `POST /auth/signup/otp/send` (signupToken, phone); email path unchanged (`/auth/signup/email/start`).
- Verify: Google path → `/auth/signup/otp/verify` → `/auth/google/sign-up` (password, name, acceptTerms) → /onboarding.
- Old separate Google card (GoogleWhatsAppVerify) removed from AuthView; component still used by SignupView, invites, co-counsel.

## Impact map
- No API change. Server still takes the email from the Google token, never from the form.
- Same Terms box, password rule and phone checks as the email form. terms-consent test counts boxes (now 1 box, 2 calls).

## Edge cases
- Wrong Google account → "Use a different account" clears the Google details and brings the Google strip back.
- Google account already has an account → unchanged (409 account_exists → Sign in).
- OTP / sign-up errors show in the form; "Change details" resets them.

## Acceptance criteria
- AC1 name + email filled from Google, email locked. AC2 Google strip hidden, way back offered.
- AC3 START sends the code for the Google token with the typed number.
- AC4 Verify → Google sign-up with the verified token, password, name, acceptTerms.
- AC5 "Use a different account" clears name/email and unlocks the email.
