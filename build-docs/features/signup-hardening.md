# Sign-up hardening (F1–F7)

Status: built 2026-11-17 on branch `fix/signup-flow`, not deployed. Owner approved the fixes on 2026-11-17, after the end-to-end audit of account creation.

## Purpose
The audit found that the paid-only sign-up could be bypassed or broken:
- **F1:** an abandoned sign-up that paid from the renew screen was charged twice and lost its paid plan.
- **F2:** an unpaid team sign-up got the Firm tier with 8 seats, and its invitees used the app free for 14 days.
- **F3:** email + password sign-up never proved the email, so an attacker could pre-register someone else's address. Google sign-in then linked the victim to that account by email.
- **F4:** two parallel deliveries of one payment could add two periods.
- **F5:** with payment keys off, every sign-up silently became free until 2027.
- **F6:** Terms consent was enforced only in the web app.
- **F7:** "free" wording, an unverified number could receive the invoice on WhatsApp, and `onboarded_at` was set outside the insert transaction.

## Architecture (as built)
- **F2 / F7: new firm shape.** `auth.service` `insertUserWithNewFirm(record, name, mode)`:
  - `'unpaid'` is used by every self-serve sign-up (Google, and dev password sign-up). It creates Solo tier, 1 seat, `plan_status 'trial'`, `trial_ends_at null`, `free_plan false`. `onboarded_at` is null and written by the same insert.
  - `'free_guest'` is used by co-counsel guests and dev auto-provision. It keeps their previous behaviour (free launch, onboarded).
- **F2 / F7: onboarding never raises tier or seats.** `onboarding.complete` sets Solo / 1 seat and a 30-minute window. Tier, seats and credits come only from `applyPlanPayment` (or a custom plan).
- **F2: members only on a set-up, paid firm.** `invitations.service` `assertFirmPaidForMembers(firmId)` requires all of:
  - `plan_status = 'active'`;
  - not `free_plan`;
  - `renews_at` null or not before today;
  - no owner with a null `onboarded_at`.

  Otherwise it returns 402 `plan_required`. It runs on POST /invitations (before the member-admin check, so the message is clear), on invite accept, and on Roles & Access "Add member". The web interceptor passes this 402 through (it does not sign out). Native shows "Your plan isn't active."
- **F1: never pay twice.**
  - `completeSignIn` lets a not-onboarded account sign in (no 402 renew token). It goes to /onboarding; the app stays closed with 403.
  - `applyPlanPayment` sets `onboarded_at = now()` for that firm's not-onboarded users.
  - `onboarding.complete` on an already active paid firm saves the details only. It keeps the plan and opens no checkout.
- **F4: one activation per payment.** `applyPlanPayment` locks the firm row (`for update`) before the "already applied?" check. No migration.
- **F5: no free fallback.** `onboarding.complete` with a paid plan and payments off returns 503 `payments_disabled` and changes nothing. A firm that already has `free_launch` can still pick `free`.
- **F6: consent checked by the server.**
  - `plan-status` loads `termsAccepted`: the latest `consent_log` answer for the current `TERMS_VERSION`.
  - `requireActivePlan` returns 403 `terms_required` when it is false.
  - `/auth/*`, `/me/*`, `/me/dpdp/*`, `/billing`, `/onboarding` and `/notifications` are not gated.
  - `POST /me/dpdp/consent` clears the plan-status cache.
- **F3: Google only for new accounts.**
  - `/auth/signup/email/start` and `/auth/signup/email/complete`, and the AuthView email form, are removed.
  - Google sign-in to an email whose account has no `google_sub` returns 409 `google_link_required`: "This email already has a DifAi password. Sign in with your password, then connect Google from Settings."
  - New `POST /auth/google/connect` (signed in) verifies the credential with the same verifier. The Google email must equal the account email (400 `google_email_mismatch`), and the Google account must not be linked to another user (409 `google_linked_elsewhere`).
  - Settings → Account shows "Sign in with Google" (connect).
- **F7: smaller fixes.**
  - Removed "Create your free account" (API `account_not_found`) and "Your free access has ended" (sign-in banner).
  - Invoice WhatsApp now goes only to an OTP-verified number (`phone_verified_at`), like plan-active.

## Impact map
- **API files:**
  - Services: `services/auth.service.ts`, `onboarding.service.ts`, `billing.service.ts` (`applyPlanPayment`), `invitations.service.ts`, `firm-admin.service.ts` (`createUser`), `plan-status.service.ts`, `invoice-whatsapp.service.ts`.
  - Middleware and routes: `middleware/requireActivePlan.ts`, `routes/auth.routes.ts`, `routes/invitations.routes.ts`, `routes/me-dpdp.routes.ts`.
- **Web files:** `views/AuthView.tsx` (email sign-up form removed), `views/SettingsView.tsx` (connect Google), `hooks/useAuth.ts`, `lib/play-policy.ts` (`plan_required`).
- **Could break:**
  - Integration fixtures now record Terms consent for seeded users (`seedUser termsAccepted`, default true).
  - A user with no granted consent for the current Terms is now refused by the API, not just by the web gate.
  - Legacy password accounts must connect Google before Google sign-in works.
  - Firms that are active but past their paid-until date can't invite.
- **DB:** no migration.

## Edge cases
- Old abandoned team sign-ups (Firm tier, expired 14-day trial) now sign in and land on /onboarding, which resets them to Solo / 1 seat before checkout.
- A paid firm whose owner never onboarded opens straight away (webhook), keeping the derived firm name (editable in Settings).
- A different-email Google account can't be connected; neither can a Google account already linked elsewhere.
- Co-counsel guest accounts keep their free launch (open item for the owner: they still get a free own-firm account until 1 Jun 2027).
- A plan bought via the renew screen before onboarding keeps the sign-up role (Solo Advocate for a solo sign-up who bought Chambers). This is rare, since new accounts never get the renew screen.

## Acceptance criteria (tests: `apps/api/src/routes/__tests__/signup-flow.integration.test.ts`, 19 tests)
1. **F1:** a never-onboarded account signs in (200), is sent to onboarding, pays once, and the app opens. A payment applied before onboarding opens the app. A later onboarding call opens no checkout and keeps the plan.
2. **F2:**
   - A new firm is Solo / 1 seat / no trial / not free / not onboarded, with 0 AI credits.
   - Invites before onboarding, or inside the unpaid window, get 402 `plan_required`.
   - After paying Chambers, inviting works, but accepting after the plan lapsed gets 402.
3. **F3:**
   - The email sign-up routes return 404.
   - Google sign-in to a password-only email gets 409 `google_link_required` and nothing is linked.
   - Connect works only signed in and for the same email; then Google sign-in works; a Google account linked elsewhere gets 409.
4. **F4:** one payment delivered in parallel under 2 event ids gives one period, one event and one invoice.
5. **F5:** with payments off, a paid plan gets 503 `payments_disabled` and nothing changes. A free-launch account still onboards free.
6. **F6:**
   - A declined or missing consent gets 403 `terms_required` on app routes.
   - `/auth/me` and the consent endpoint keep working.
   - Agreeing reopens the app.
7. **F7:** an unverified number gets no invoice WhatsApp. There is no "free" wording in these messages, and tier and seats are not raised before payment.
