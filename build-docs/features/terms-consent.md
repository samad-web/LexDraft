# Feature: Terms + Privacy consent (agree / disagree)

Status: approved 2026-11-14 ("proceed"), built 2026-11-14.

## Purpose
- The DPDP Act needs consent by a clear affirmative action, with proof of what was agreed. Before this, sign-up showed only a notice line and kept no record.
- Existing users never accepted Terms v1.1.

## Architecture
- **Storage:** the existing `consent_log` table (migration 0020: user, firm, type, version, granted, ip, user_agent, time). Type `terms_privacy`, version = `TERMS_VERSION` (`apps/api/src/lib/legal.ts`, mirrors web `LEGAL_VERSION`). **No migration.**
- **Accepted?** `USER_SELECT_WITH_FIRM` reads the latest `consent_log` row for (user, `terms_privacy`, current version). If it is not `granted = true`, `User.needsTermsAcceptance = true`. Bumping `TERMS_VERSION` re-asks everyone.
- **Sign-up:**
    - The schemas for `/auth/sign-up`, `/auth/signup/email/complete` and `/auth/google/sign-up` require `acceptTerms: true`, so the server refuses without it.
    - After the account is created, a granted row is written with ip/ua.
    - If that write fails, the account still exists and the gate asks for consent.
- **Gate (existing users, invite/co-counsel joiners):**
    - The App shows `TermsConsentView` before onboarding/app when `needsTermsAcceptance` (not superadmin, not act-as).
    - Agree → `POST /me/dpdp/consent` granted=true → refetch `/me`.
    - Disagree → the same endpoint with granted=false, then sign-out. The screen says how to export or delete by email.
- **UI:** shared `TermsAgree` checkbox (unticked, required) on the 4 sign-up forms: AuthView email + Google, SignupView trial/paid + demo.
- **Privacy Part C** text describes the tick box and the consent record.

## Impact map
| Area | File | Risk |
|---|---|---|
| Auth API | auth.routes.ts, auth.service.ts | old clients without `acceptTerms` get 400. The APK loads the live web, so there are none |
| User select | auth.service.ts `USER_SELECT_WITH_FIRM` | a subquery on every user load; uses the index `consent_log_user_idx` |
| Types | packages/types `User.needsTermsAcceptance` | none |
| Web routing | App.tsx gate | public pages (/terms, /privacy) stay reachable from the gate (new tab) |
| Sign-up UIs | AuthView, SignupView | the button stays disabled until ticked |
| Legal text | LegalView Part C | the test asserts the wording |

## Edge cases
- Untick after ticking → the button is disabled again.
- A tampered request without `acceptTerms` → 400 from the server.
- Disagree → recorded and signed out. The next sign-in asks again.
- Superadmin / act-as sessions are never gated.
- The consent write fails at sign-up → the gate catches it.

## Acceptance criteria
1. The 3 sign-up endpoints reject a body without `acceptTerms: true` (400).
2. A successful sign-up writes a granted `terms_privacy` row for `TERMS_VERSION` with the IP, and the returned user has no `needsTermsAcceptance`.
3. A user with no granted row for the current version gets `needsTermsAcceptance: true`; after `POST /me/dpdp/consent` it clears. A later decline sets it again.
4. The web sign-up buttons are disabled until the box is ticked, and every sign-up call sends `acceptTerms: true`.
5. App shows the consent gate when `needsTermsAcceptance`, except for superadmin and act-as.
6. API `TERMS_VERSION` equals web `LEGAL_VERSION`.
