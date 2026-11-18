# Coming soon + co-counsel WhatsApp send (owner 2026-11-18)

## Purpose
Owner: mark eFiling, Clause Bank, Matter Intelligence, Title Reports, Mock Arguments as "Coming soon". Co-counsel: one-tap send of the handover link on WhatsApp.

## Architecture
- `NavItem.comingSoon` → SOON badge (replaces AI) in sidebar/CmdK. Routes wrapped in `<ComingSoon feature>` (page code kept; remove the wrapper to switch back on).
- Dashboard KPI "Objections to cure" (eFiling) no longer offered; defaults use next7 / noNextDate / activeMatters.
- HandOffCaseModal: "Send on WhatsApp" = wa.me/<bound number>?text=<case + link>; the native share sheet becomes "Other ways to share…". Access rules unchanged: link bound to that WhatsApp number (OTP), guest sees only that case.

## Impact map
- nav-config, App.tsx routes, DashboardKpis, HandOffCaseModal. No API/DB change. Case-page tabs (e.g. Intelligence) untouched.

## Acceptance criteria
- AC1 five items show SOON; others unchanged.
- AC2 WhatsApp link: number with 91 prefix, case title + accept link; none without a number.
- AC3 each route shows "<feature> is coming soon".
