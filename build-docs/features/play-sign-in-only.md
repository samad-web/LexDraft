# Play: Android app is sign-in only

Owner decision 2026-11-17. Supersedes the 2026-11-03 "hide purchase UI" note where the two differ.

## Purpose
- Google Play Payments policy: an app that sells digital goods/services must use Play Billing, and may not steer users to pay elsewhere (no prices, buy/upgrade buttons, checkout, or "visit our website to subscribe" text).
- DifAi has no Play Billing. So the Android app (Capacitor shell loading the live site) is **sign-in only**: sign-up and every payment happen on the website.
- The website behaves exactly as before.

## Rule (native = `isNativeApp()` / `Capacitor.isNativePlatform()`)
- No sign-up, no prices (₹), no buy / pay / upgrade / renew buttons, no checkout, no text or links pointing to paying elsewhere.
- Allowed: sign in (email + Google), invitations (joining an existing firm or a co-counsel grant is not a purchase), free features, usage info (credits left, plan name, dates).

## Architecture
- `apps/web/src/lib/play-policy.ts`: `NATIVE_COPY` (every neutral line) + `nativeErrorCopy(code)` (server error code -> neutral line in native, null on web).
- `lib/api.ts` response interceptor: in native, replaces the message of `account_not_found`, `plan_*`, `trial_expired`, `onboarding_required`, `seat_cap_exceeded`, `storage_full` (their server text says "Create your free account", "renew", "upgrade", "add a seat").
- Per-surface branches on `isNativeApp()`:

| Surface | App | Website |
|---|---|---|
| `/` AppWelcomeView | Sign in + "Sign in with your DifAi account." | Landing (unchanged) |
| `/signup` | redirects to `/` | SignupView |
| `/onboarding` (needsOnboarding) | `NativeSetupIncompleteView`: "Your account setup isn't complete." + Sign out | OnboardingView |
| AuthView `?signup=1` | Sign in tab | sign-up tab |
| AuthView footer links (Create account, Book a demo, Talk to us) | hidden | shown |
| AuthView Google, no DifAi account | "No DifAi account is linked to this Google account." | Google sign-up flow |
| AuthView email, no account | "No DifAi account uses this email." (no link) | + Create your account |
| AuthView 402 renewToken / `?reason=` banner | "Your plan isn't active." | plan picker + Pay / renew text |
| CapExceededModal | usage facts only | + plans / Brief Pack / upgrade line + button |
| LockedDraftCard | "Not enough credits left to unlock this draft." | See plans and Brief Packs |
| FreePlanLocked | "X isn't included in your plan." | paid-plans text + See plans |
| TrialBanner | plan-end date only; unpaid = "Your plan isn't active." | Renew / Pay now / See plans |
| BillingView | status, credits, Munshi panel; no plans, Brief Packs, invoices (₹), Razorpay, "Pay below"/"Pick a plan"/"Pay by" | unchanged |
| MunshiPanel full | "Remove someone first." | "Add a seat below, or …" |
| MembersView plan gate | "… aren't included in your plan." | + Upgrade sentence |
| SettingsView demo copy | no "Convert to a real account" | unchanged |
| CreditMeter, no credits | "No AI credits yet." | "… added as soon as your plan is paid." |

## Impact map
- `App.tsx` routing (public `/signup`, onboarding gate) — web routes unchanged.
- `AuthView.tsx` — sign-in, Google, MFA untouched; sign-up code only reachable on web.
- `lib/api.ts` interceptor — message rewrite only in native; logout/redirect/cap-modal logic unchanged.
- `InviteAcceptView`, `CoCounselAcceptView`, `GoogleWhatsAppVerify` — unchanged (invites keep working in the app).
- API — untouched. Server messages are rewritten client-side.
- Android project (`apps/web/android`) — untouched; the app loads the live site, so this ships with a web deploy.

## Edge cases
- Native user who started sign-up on the website but did not finish onboarding: sees the setup notice; signing out is the only action.
- Owner whose plan lapsed: 402 at sign-in shows "Your plan isn't active."; no renewToken use in the app.
- Mid-session 402 (plan inactive): interceptor signs out and lands on `/auth?reason=…` → neutral banner.
- Deep links `/signup?intent=…`, `/auth?signup=1`: sign-up never shown.
- Legal pages (`/terms`, `/refund-policy`) still describe prices/checkout as contract text with no link or button; reachable in the app. Flagged to the owner.

## Acceptance criteria (tests: `apps/web/src/lib/__tests__/play-sign-in-only.test.tsx`, AC1–AC22)
- AC1 welcome: Sign in + neutral line, no sign-up/price.
- AC2–AC8 `/signup` redirect, onboarding notice, `?signup=1` → Sign in, web links kept, Google/email no-account notices, invites route untouched.
- AC9–AC10 plan-inactive banner and renew block neutral in app; web unchanged.
- AC11–AC12 cap modal: no steering in app; web keeps plans/Brief Pack lines.
- AC13–AC20 locked draft, free-plan lock, banners, billing status/notes, billing sections, credit meter, Members/Munshi/Settings.
- AC21 interceptor rewrites purchase wording in native only; AC22 no NATIVE_COPY line contains purchase words.
