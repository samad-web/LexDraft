---
name: lexdraft-dashboard
description: Build, change or review the LexDraft dashboard (/app/dashboard, AdvocateDashboardView) and dashboard-style overview pages in the house design - greeting block, 2x3 tinted KPI cards, Priority / Schedule split, footer - in both light and dark mode. Use whenever touching AdvocateDashboardView.tsx, the `.adv-*` styles in globals.css, the /dashboard/today API, or when asked to make a page "look like the dashboard".
---

# LexDraft dashboard design

Source spec: `dashboard-design.md` (repo root) - a workspace "Overview" page.
This skill is that spec translated to LexDraft (advocates, matters, courts),
plus the rules that keep it right in **both themes** and on phones.

Files:
- View: `apps/web/src/views/AdvocateDashboardView.tsx` (rendered by `DashboardView.tsx`)
- Styles: `apps/web/src/styles/globals.css`, block `ADVOCATE DASHBOARD` (all classes `adv-*`)
- Data: `GET /dashboard/today` → `apps/api/src/services/dashboard-today.service.ts`,
  type `DashboardToday` in `packages/types/src/index.ts`; plus `/me/usage`
  (`useMyUsage`), `/ecourts/sync/status` (`useEcourtsSyncStatus`), auth store `user`.

## Page anatomy (top to bottom)

1. **Greeting block**
   - Date, small uppercase, `--text-tertiary`: `WEDNESDAY, 21 OCTOBER`
   - Headline `Good evening, {first name}` - time-of-day greeting, **first name emphasised by weight** (no accent colour)
   - Subtext `{firm} · {N} active matters · {N} listed this week`
   - Right: `All matters` link-button, `MoreMenu`, then the one primary action (`btn btn-primary` New matter).
2. **Action KPI cards - 2 rows × 3** (`ActionKpis`). The user's rule: KPIs must be *catchy and
   worth acting on* - every card answers "what do I do today?". Each card = icon chip + UPPERCASE
   label, big number, **one specific clue** (a real matter/date, `<strong>` on the key bit),
   and a **CTA line** (`label →`) that is the link. Urgent cards get a status-coloured left edge
   + an "Act now" (rose) / "Due" (amber) pill. Zero must read as good news, never a dead "0".
   | Card | Tone when > 0 | Clue | CTA → route |
   |---|---|---|---|
   | Hearings today | - | `First: {time} · {court}` / "No hearings today. A good day for drafting." | Open cause list → `/app/causelist` |
   | Next 7 days | - | `Busiest: {day} · {n} hearings` | Open calendar → `/app/calendar` |
   | Limitation due (`in 7 days`) | rose | `Earliest: {matter} · {detail}` | Limitation tracker → `/app/limitation` |
   | Objections to cure | rose | `{filing} · {raised}` | Cure in eFiling → `/app/efiling?m=objections` |
   | No next date (`of {active} active`) | amber | `{matter} · {court}` | Post next dates → `/app/cases` |
   | Fees overdue (billing.view) / else Overdue pendings | amber | `{n} invoices past due` / first task | Follow up invoices / Open tasks |

   **Firm view** (`FirmKpis`, only with `firm.dashboard.view` - partners / firm admins / PG leads).
   **No switch** (user decision 2026-10-22): the view follows plan + role automatically -
   Solo and associates on any plan → personal "My day"; Practice-plan group lead → "chambers" view;
   Firm-plan partners / firm admins → "firm" view (wording via `useOrgWord()`). Leaders' own items
   are marked "You" inside the firm view. Firm KPIs: Hearings today (firm-wide · courts · advocates
   appearing) · **Unassigned hearings** (rose today / amber week → Assign advocates) · Limitation due ·
   Objections to cure · **Team load** (busiest advocate vs average; amber at ≥1.75× avg) ·
   **Revenue this FY** (+delta %, overdue fees). Firm view also shows the advocate on each upcoming
   hearing ("You" / name / red "No advocate · Assign") and a **Workload by advocate** card
   (matters bar + in court today / this week). Data: `DayHearing.advocate` + `/firm/dashboard`.

   NOT KPIs (live elsewhere, don't duplicate): plan/trial (TrialBanner), AI quota (sidebar meter),
   eCourts coverage (eCourts page + "connect" flows).
   Phones: labels and clues wrap to 2 lines (line-clamp), Act pill hidden.
3. **Lower split (2 columns, equal height)**
   - Left - eyebrow `PRIORITY`, title `Needs attention`, right link `Review all` (expands every item).
     One row per item: initial avatar (tinted), item name, status line `{source} · {detail}`,
     right pill (`Urgent` rose / `Overdue` `Post date` amber / `Review` `Reply` `Pending` blue), chevron.
   - Right - eyebrow `SCHEDULE`, title `Upcoming hearings`, right link `Calendar`
     (+ `Mine / Firm` toggle when `canSeeFirm`). Rows: date block, matter, `purpose · court`, time pill (`Today` highlighted).
     Empty: calendar icon + `No upcoming hearings`.
4. **Footer** - `© {year} {firm}. All rights reserved.` left, `Powered by Sirah Digital` right.

Not on this page (lives elsewhere): trial banner (`TrialBanner`, app shell), firm-wide analytics (`/app/firm`).

## Colour rules - match the app UI (design-system.md is the authority)

The user's rule: **the dashboard's colours must match the rest of the app UI.**
`design-system.md` says: pure monochrome, **no accent colour**, status colours only on
status badges/indicators. So, overriding the "tinted card" idea in `dashboard-design.md`:

- Cards (KPI + sections) use default card styling: `--bg-surface`, `1px --border-default`,
  `--radius-lg`. No tinted backgrounds, no coloured numbers, no gold/brand accent.
- Hierarchy by weight and ink, not colour: greeting `--text-secondary` weight 500 with the
  **name in `--text-primary` bold**; metrics `--text-primary`; eyebrows `--text-tertiary`.
- Primary action = the app's `btn btn-primary` (inverse: black on white / white on black).
  Pill tabs and "today" date block = inverse too. Progress bars fill with `--text-primary`.
- Avatars / icon chips: `--bg-surface-2` circle/square, `--border-default`, `--text-primary` glyph.
- **STRICT black & white (user rule, 2026-10-22).** No amber, yellow, green or blue anywhere -
  not on pills, edges, dots, checks or text. Every `.tint-*` maps to neutral.
- **The only colour is red, and only as a button (`.adv-alert-btn`) that names a MANDATORY
  issue**: "2 limitations due", "Cure 1 objection", "Assign advocate · 1 today", "Limitation due".
  Mandatory = limitation deadline in 7 days, eFiling objection, hearing today with no advocate.
  Everything else (overdue tasks, no next date, fees, unassigned later this week) is a neutral
  outline pill or plain bold text. No red text, red edges or red dots.
- Never hard-code a colour; only tokens from `tokens.css`, so light and dark follow the app theme.

## Behaviour rules

- Show **real** zeros only when meaningful; sections the user can't access come back `null` from the API - hide them, never show `₹0` as a fake.
- Permission-gate actions with `useCan` (`matter.create`, `drafting.ai`, `leads.create`); billing figures only if `practice.overdueInvoices !== null`.
- Every row/card is a link to where you act on it (`/app/cases/:id`, `/app/limitation`, …).
- Empty states: icon in a tinted square + one plain sentence + (optionally) one action.
- Phones (≤640px): KPI grid 2 columns; labels one line (`.adv-fig-text` ellipsis); primary button full width on top; pills other than time hidden; lists single column.
- Containers that host `MoreMenu` must **not** use `overflow: hidden` (the dropdown gets clipped).

## Verify - always, both themes

Run the mocked-API screenshot harness (dev server on :5173 must be running; no real data used):

```
node .claude/skills/lexdraft-dashboard/scripts/shoot.mjs --out <scratchpad> --theme light --scenario busy
node .claude/skills/lexdraft-dashboard/scripts/shoot.mjs --out <scratchpad> --theme dark  --scenario busy
node .claude/skills/lexdraft-dashboard/scripts/shoot.mjs --out <scratchpad> --theme light --scenario quiet
node .claude/skills/lexdraft-dashboard/scripts/shoot.mjs --out <scratchpad> --theme dark  --scenario quiet --menu
```

`busy` = partner on trial with hearings, attention items, billing; `quiet` = associate, nothing listed, no billing.
Read every PNG and check: colours match the sidebar/topbar (monochrome; colour only on pills/dots),
no clipped menu, no ragged/wrapping KPI labels, equal-height split, no `undefined` text,
no mojibake (₹, ·), nothing overflowing on phone.
New API fields: render a fallback when the field is missing (a stale dev server sends the old shape).
Then `apps/web/node_modules/.bin/tsc.cmd --noEmit -p apps/web` must exit 0.
If the page still looks old in the real app, the OneDrive file watcher missed the change - restart `pnpm dev`.
