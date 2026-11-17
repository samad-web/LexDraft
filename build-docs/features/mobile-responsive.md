# Mobile responsive (phones + tablets)

Owner request 2026-11-17: make the web app fully responsive on phones and tablets (the Android app loads the same site). Not deployed.

## Purpose
- Advocates use DifAi on phones in court and in the Android app (Capacitor shell over the live site). Every screen must work at 360px and up, with thumb-sized controls and no iOS zoom on form fields.

## How it was audited
- Local dev stack only (web :5173, api :4000, local Postgres :5433), signed in as the local Play-review account with fictional data (films/difai/build/seed.mjs matters + fictional clients/leads/tasks/invoices/expenses added through the local API and removed afterwards). No production data, no live site.
- Script: `apps/web/scripts/mobile-audit.mjs` (Playwright). 51 app/public screens + 7 case-detail tabs + 9 overlays (drawer, 7 "new" modals, Ctrl-K) + 5 admin console screens + native-mode screens at 390, each at 360x800, 390x844, 768x1024, 1024x768 (touch) and 1366x768 (mouse, regression baseline). About 70 captures per width.
- Checks per capture: page overflow (`scrollWidth > innerWidth`), elements past the screen edge (outside a scroll box), text overflowing its box, tap targets < 44x44 (and < 24x24), form fields < 16px, dialogs larger than the screen, sticky/fixed bars covering > 30% of the screen. Plus a look at every phone screenshot.
- Tap-target rule: inline links inside a sentence are exempt (WCAG 2.5.8 inline exception); a checkbox/radio counts by its label when the label is >= 44px; sr-only inputs (1px) and the off-screen skip link are not targets.
- Native mode: `window.androidBridge` stub makes Capacitor report Android; the app lock is set off for the run (with the stub, the biometric check never answers, so the lock screen would hang the page).

## Findings (before) and fixes

Already good (no change): no screen overflowed the page at any width; tables stack into cards on phones (lib/chambers.ts data-labels) and scroll inside their card on tablets; modals are bottom sheets on phones with a sticky footer; bottom dock + FAB; Kanban move-selects on touch.

| # | Screen(s) | Issue | Width | Fix |
|---|---|---|---|---|
| 1 | Every app + admin screen | Closed nav drawer's shadow drew a grey strip down the left edge; its ~30 off-screen links stayed in the keyboard/screen-reader order | < 768 | `.sidebar:not(.is-open)` gets `visibility: hidden; box-shadow: none` (visibility flips after the 220ms slide so closing still animates) |
| 2 | Top bar on every app screen | Title cut mid-word ("Mock Argu", "People & Ro", "Plan & Billin") | 360-390 | Icons edge to edge (gap 0); title wraps to 2 lines (line-clamp 2) |
| 3 | Top bar | Menu/search/theme/bell/sign-out icons 38x38, Back 36x34 | touch | 44x44 (40x44 at <= 374px so the title keeps room) |
| 4 | All screens with `.btn`, `.btn-sm` | Buttons 42px, small buttons 34px (row actions, toolbar, calendar nav, doc actions, lead cards, billing cycle) | touch | `--btn-h` / `--btn-sm-h` 44px on a coarse pointer; `.btn` min-width 44px (icon buttons) |
| 5 | Cases, clients, invoices, expenses, documents, cause list, diary, research | Filter chips 30-36px | touch | min-height 44px |
| 6 | eCourts, calculators, settings, case tabs, calendar/diary | Pill tabs 35px, segmented toggles 32px, matter-intel tabs 43px wide | touch | min-height/width 44px |
| 7 | Calculators | % / Rs line-type toggle 32x28 (inline size) | touch | size moved to CSS `.calc-seg-btn` (32x28 desktop, 44x44 touch) |
| 8 | Clients, client detail, dashboard, auth, documents, clauses, draft, leads, tasks | Small text-style targets: client name 26px, "< Clients" back 21px, adv "Calendar" link 22px, e-mail link 22px, password eye 20x20, "Forgot password?" 21px, folder buttons 36px, clause categories 38px, starters 35px, lead delete 34px, move selects 40px, select triggers 40px, `<summary>` 17px | touch | min-height (and min-width for icon ones) 44px |
| 9 | Sign-up | "DifAi home" logo button 59x22 | touch | class `signup-home`, min-height 44 on touch (`!important` beats its inline `all: unset`) |
| 10 | Auth, onboarding, review, draft, tasks, leads, Ctrl-K, all search boxes, case CNR, matter-intel composer | Form text 13-15.5px makes iOS zoom in on focus (25 fields at 360, 88 at 768 incl. tablets) | touch | all inputs/selects/textareas 16px on a coarse pointer (`!important` beats inline sizes; the OTP 24px and land-record 18px fields keep theirs) |
| 11 | Checkboxes/radios (eFiling "Show Password", terms consent) | 13-16px boxes | touch | 20x20 |
| 12 | New case / any `Field` with a hint | Hint cut with an ellipsis ("change it late...") | < 641 | `.field-label:has(.field-hint)` wraps |
| 13 | Invoices (stacked cards) | Relative due ("in 17 days") sat between the label and the date | < 641 | due cell wraps; relative text on its own line, right-aligned |
| 14 | Every app screen, drawer open | Opening the drawer on a tablet dropped the page into the 64px rail column: content squeezed to 16px behind the scrim; items in later nav sections sat 12px left of the first | 768-1023 | `.app > .main { grid-column: 2 }`; open-drawer items keep their margin |
| 15 | Admin → Users | 10-column table + 4 fixed-width filters widened the page by 114px and squeezed the search box to 34px | 1024 | table in its own sideways-scroll box; filter row wraps, search min 220px (UsersView) |
| 16 | Onboarding, practice analytics, team chat, new expense, eFiling, drawer | Billing-cycle toggle 38px, segment buttons 40px, chat search 38px, tick-box labels 20px, open-drawer items 36-40px, seat select 36px, onboarding chips 39px | touch | min-height 44px |
| 17 | Calculators (fee sheet) | Basis amount input squeezed to 34px between rate and result | 1024 | the line row wraps; basis min 96px |
| 18 | Top bar (tablet landscape) | Full search button 38px tall | touch | 44px |

Not changed (and why):
- Top bar icons at 360px: 40x44 (six 44px icons would leave the title ~76px).
- Google sign-in button (40px tall): drawn by Google in an iframe; size "large" is its maximum.
- Matter-intel search and Ctrl-K inputs: the input itself is 26-42px but sits in a 44px+ box that focuses it.
- Landing page "Already have an account? Sign in" (222x22): landing is being edited by the app-handoff work; left for that change.
- Calendar month grid at 360-390: day cells 40x58 (7 columns can't be 44 wide in 296px); spacing between cells meets WCAG 2.5.8.
- eFiling login "New User? Register here" / "Forgot Password" links (20px): the panel mirrors the portal's own layout; links are spaced > 24px apart.
- Dashboard / Manage KPI strip: flagged as "past the edge" by the script, but it is the intended sideways-scrolling card carousel (page itself does not scroll).
- Tablet tables (768): Status/last columns scroll inside the card (contained horizontal scroll, as intended).
- Admin console data screens: the local account isn't a superadmin, so admin APIs return 403 and the pages show loading/empty states; only the shell/drawer/header layout was checked.
- Team chat: "Couldn't load conversations" locally (API error in local dev, not layout).

## Architecture
- One central block at the end of `apps/web/src/styles/chambers.css` ("TOUCH + PHONE FIXES"), selectors prefixed `:root[data-ui='chambers']` so they beat the per-area files (chambers/*.css load after chambers.css).
- `@media (pointer: coarse)`: touch devices of any width (phones, tablets, Android app). Mouse users keep desktop density.
- `@media (max-width: 767px)` / `(max-width: 640px)`: existing phone breakpoints (no new breakpoint except `max-width: 374px` for 360px phones' top bar).
- Component tweaks only where inline styles or markup made CSS impossible: CalculatorsView (line-type toggle size moved to a class), SignupView (class on the logo button), admin UsersView (scroll box around the table, wrapping filter row).

## Impact map
- `styles/chambers.css` → every signed-in screen, auth, sign-up, onboarding, admin console (all `data-ui=chambers`). Landing (`data-ui=landing`) untouched.
- Touch: buttons/inputs grow 2-10px; table rows with row actions get taller on tablets. Desktop (mouse) unchanged: 1366 audit numbers identical before/after.
- `CalculatorsView.tsx` (fee line toggle), `SignupView.tsx` (header logo), `admin/views/UsersView.tsx` (table scroll box). No behaviour, copy or API change. BillingView/landing/payment-success not edited (only the shared `.cm-cycle button` min-height applies on touch).

## Edge cases
- Drawer: visibility switches instantly on open (no delay) and after the slide on close; Escape/scrim close unchanged. Tablet rail (768-1023) untouched.
- Very long titles: 2 lines then ellipsis.
- 16px rule skips checkbox/radio/range/file/color inputs.
- Dark mode: no colours added; all rules are sizes/visibility.

## Acceptance criteria
1. AC1 No horizontal page scroll at >= 360px on any audited screen (page overflow 0 at all widths).
2. AC2 All actions reachable: nothing clipped off-screen; closed drawer not focusable; modals fit the screen (dialogs over the screen = 0).
3. AC3 Tap targets >= 44x44 on touch screens, except the documented exceptions above.
4. AC4 Form fields >= 16px on touch screens (iOS no-zoom).
5. AC5 Titles, field hints and stacked-card cells are not cut off.
6. AC6 No layout regression at 1366 (mouse): same counts before/after, screenshots unchanged.

## Tests
- `apps/web/src/styles/__tests__/mobile-responsive.test.ts` (vitest): the central rules exist with the right values and stay touch/phone-scoped.
- `apps/web/scripts/mobile-audit.mjs` (Playwright, local only): browser layout checks + screenshots; before/after counts in TESTING.md.
