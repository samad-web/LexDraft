# Co-counsel guest scope

Status: LIVE 2026-11-19 (8ea6e0f). Prod had 0 earlier guest accounts.

## Purpose
Sign-up is paid only, but a new advocate accepting a co-counsel link got a full free account (free launch plan until 1 Jun 2027). Anyone could get a free DifAi through a handover link. Now the guest gets the shared matter only; everything else needs a paid plan.

## Architecture
- `auth.service.registerCoCounselGuest` creates the guest's own Solo firm as `'unpaid'` (no trial, not free, not onboarded), same as self-serve sign-up. `'free_guest'` stays for dev auto-provision only.
- Server: `/co-counsel/*` is mounted without `requireActivePlan`, so guest-cases list/detail/leave keep working; every other feature route answers 403 `onboarding_required`.
- Web (`App.tsx`): a not-onboarded user on `/app/co-counsel/:caseId` gets that page alone with a "Choose a plan" bar; any other path redirects to `/onboarding`. `OnboardingView` lists "Shared with you" matters (useGuestCases).

## Impact map
- auth.service (guest provisioning), co-counsel accept flows (new + existing users; existing users unchanged), plan-status gate, App routing, OnboardingView.
- Existing prod guest accounts made before this keep their free plan (no data change, per no-live-DB-changes rule).

## Edge cases
- Guest revoked/leaves: page 404s → back link → /onboarding.
- Guest later pays: onboarding completes, normal app, grant still listed under Co-Counsel.
- Existing DifAi user accepting: keeps own firm/plan (unchanged).

## Acceptance criteria
- AC1 new guest firm: free_plan false, no trial_ends_at, onboarded_at null.
- AC2 plan state not onboarded → plan-gated routes refuse.
- AC3 the shared matter opens; another firm matter does not (404).
- AC4 web: guest without a plan reaches only /app/co-counsel/:caseId before the onboarding redirect.
- AC5 web: plan page lists matters shared with them.
