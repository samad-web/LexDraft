# Forgot password via WhatsApp code (2026-11-18, approved + built)

## Purpose
"Forgot password?" today is a mailto to support. Owner: reset it in the app. Prod has no SMTP, and every customer account has a WhatsApp number verified at sign-up, so the code goes on WhatsApp (owner's choice).

## Architecture
- Web (AuthView, sign-in card): "Forgot password?" → step 1 work email → step 2 6-digit code + new password → "Password changed, sign in".
- API:
  - `POST /auth/password/forgot {email}` (otpSendLimiter). Finds a user by email with a verified phone, not superadmin, not suspended → WhatsApp code (existing Wasi template `lexdraft_otp`). ALWAYS answers the same `{challengeId, resendAfterSeconds}`; unknown email → random id, no message sent. No phone hint (would leak who has an account).
  - `POST /auth/password/reset {challengeId, code, password}` (signInLimiter). Verifies the code (10 min, 5 tries, one use), checks the strong-password rule, sets password_hash.
- Reuse phoneOtpService (rate limits: 30 s resend, 5 codes/hour per number).
- Migration 0117 (additive): `phone_otp_challenges.purpose` allows `password_reset`; new nullable `user_id` column (FK users, on delete cascade) binds the code to the account.

## Impact map
- phone-otp.service: purpose + user binding added; sign-up path unchanged.
- auth.routes / auth.service: two new routes. Sign-in, MFA, Google untouched (MFA still asked at next sign-in).
- AuthView sign-in card: mailto link replaced by the in-card flow.
- DB: migration 0117 on prod needs owner approval at deploy.

## Edge cases
- Unknown email / account without a WhatsApp number / superadmin → same reply, no code; the screen says "If this email has an account with a WhatsApp number, a code was sent." plus "No code? Contact support".
- Wrong code → attempts left; expired / used / 5 wrong → "request a new one".
- Weak password → same rule as sign-up, rejected by server too.
- Spam: per-IP limiter + per-number limits.
- Known limit: sign-ins already open on other devices stay valid until their 7-day token ends (JWTs are not tracked). Fix = per-request user check; separate decision.

## Acceptance criteria
- AC1 known email with verified phone → code sent to that phone, challenge bound to the user.
- AC2 unknown email / no phone / superadmin → identical response, nothing sent.
- AC3 right code + strong password → password changed; old password fails, new one signs in.
- AC4 wrong / expired / reused code, or a code from another purpose (sign-up) → refused, password unchanged.
- AC5 weak password → 400, password unchanged.
- AC6 web: link → email → code + password → success message → back to sign in.

## Notes from build
- A 429 "too many codes" can only happen for a real account's number (minor existence signal after repeated tries; per-IP limiter still applies). Accepted.
- Web: components/ForgotPassword.tsx, shown in place of the sign-in card; mailto kept as "No code? Write to support".
