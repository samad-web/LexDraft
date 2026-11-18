# Feature: Playwright full-UI test suite (web)

Status: approved 2026-11-12 (own local account; writes with cleanup)

## Purpose
- One command (`pnpm --filter web test:e2e`) checks every web screen renders, navigates and handles its main interactions, so a UI regression is caught before deploy.
- Today `apps/web/e2e/` has 3 landing/auth tests only.

## Architecture
- Runner: existing `@playwright/test` 1.62 + `apps/web/playwright.config.ts` (Chromium desktop; add a 390px mobile project for the shell).
- Backend: **real local API (:4000) + local self-hosted DB (:5433)**, never Supabase or prod.
- Sign-in: `e2e/auth.setup.ts` signs in once, saves `storageState` (`lexdraft-auth` in localStorage) to `e2e/.auth/` (gitignored). Credentials from `apps/web/.env.e2e` (gitignored), never in code.
- Stubs (`page.route`) for every endpoint that spends AI tokens or calls a third party: drafting/compose, contract review, mock arguments, research AI, matter-intel, diary assistant, eCourts/eFiling/land-records/bar-verification portals, Dodo checkout. Stubs return canned JSON so the UI path is still exercised.
- Shared fixtures `e2e/fixtures.ts`: `appPage` (signed in), page-error + console-error collector that fails the test, `stubExternal(page)`.
- Files, one per area:
  - `public.e2e.ts` — landing, /auth, /signup, /privacy, /delete-account, /survey, /portal/login, unknown route → `/`.
  - `shell.e2e.ts` — sidebar, every nav item, topbar, Cmd-K, notifications, theme toggle, skip link, 404 view, mobile dock.
  - `routes.e2e.ts` — data-driven smoke over all 44 `/app/*` routes: loads, heading visible, no page error, no 5xx.
  - `cases.e2e.ts`, `clients.e2e.ts`, `tasks.e2e.ts`, `calendar-diary.e2e.ts`, `billing-money.e2e.ts` (invoices/expenses), `drafting.e2e.ts`, `review.e2e.ts`, `calculators-sanhita.e2e.ts`, `ecourts-efiling.e2e.ts`, `settings.e2e.ts`, `admin.e2e.ts` (superadmin only, skipped if the account isn't one).
- Write tests create rows prefixed `E2E-<timestamp>` and delete them in `afterEach` through the UI/API.

## Impact map
- `apps/web/playwright.config.ts` — add setup project + storageState + mobile project; existing landing tests keep working.
- `apps/web/package.json` — no new deps.
- `.gitignore` — `apps/web/e2e/.auth/`, `apps/web/.env.e2e`, `playwright-report/`.
- Local DB — test rows created and removed; nothing touches Supabase/prod.
- No app code changes, except adding a `data-testid` where a control has no accessible name (only if needed; that is also an a11y fix).

## Edge cases and failure modes
- API down → setup fails fast with a clear message (health check), not 40 timeouts.
- Plan-gated screens (limitation, firm, members) → assert the upgrade card OR the screen, by the account's features.
- Empty account → list screens assert the empty state.
- Onboarding-pending account → setup fails with "finish onboarding first".
- Flaky waits → web-first assertions only, no `waitForTimeout`.
- A stub missing for an AI route → global guard aborts any request matching the AI list that wasn't stubbed, test fails (protects tokens).
- Leftover rows if a run crashes → `globalTeardown` deletes anything named `E2E-*` for this account.

## Acceptance criteria
- AC1 every route in `App.tsx` is covered by at least one test.
- AC2 zero uncaught page errors on any screen.
- AC3 CRUD round-trip passes for cases, clients, tasks, invoices, expenses, diary.
- AC4 no request reaches Anthropic/OpenAI or an external portal during the run.
- AC5 local DB has no `E2E-*` rows after the run.
- AC6 suite runs green twice in a row (no flakiness).
- AC7 (Play app) every sidebar screen opens with its title and no error screen; no E2E-* task/diary row left on live after the run.

## Play Store app on a phone (added 2026-11-12)
- User asked to test the Play Store app itself (2.2, versionCode 13), not a debug build.
- Playwright cannot attach to a release WebView (not debuggable, by design), and Play Protect blocks Playwright's Android driver APK on Android 16. So `e2e/native/` drives the phone with adb only: `uiautomator dump` reads the screen, `input` taps/types. Nothing is installed on the phone. Playwright stays the runner (`playwright.android.config.ts`).
- `native/adb.ts`: dump/find/waitFor/tap. `tap` scrolls a target above whatever covers it (sidebar account panel, a form's pinned footer, the bottom dock) because the tree reports bounds under overlays; never swipes while the keyboard is up (it would type). `tapPinned` for topbar/dock/footer.
- `native/app.ts`: sign-in from `.env.e2e` if signed out, tour skip, `closeOverlays` (never Back: Back on the dashboard leaves the app and reopening shows the app lock), `goNav`, `expectScreen(title)` using the app's ROUTE_TITLES, error-screen check.
- `native/play-app.e2e.ts`: dock, every sidebar item (+ section tabs), search palette, notifications, theme (restored), hardware Back, background/resume, a case detail, calculators, settings tabs, task + diary write/delete, end-of-run sweep of E2E-* tasks/diary.
- Live data: only tasks + diary are created (hard-deleted in-test, swept at the end). Cases (soft delete, 30-day purge) and clients/invoices/expenses (no delete) are never created on live. AI actions are opened, never pressed (calls can't be blocked natively).
- No page-error / 5xx detection on the phone (no WebView access); checked instead: topbar title, no "Something went wrong" / "Page not found" / offline page.
