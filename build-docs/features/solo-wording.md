# Solo wording (owner 2026-11-18)

## Purpose
After choosing the Advocate (Solo) plan the app still read like a firm: sidebar section "FIRM", breadcrumbs "Firm / Settings | Insights | Plan & Billing", Team Chat with nobody to message, Settings "role your firm sees" + "Firm: <name>". Seen live on anantha@ (Solo Advocate, Solo plan).

## Architecture
- `nav-config.visibleNavGroups(granted, plan, { hasTeam })`: the "Firm" section is titled by plan (`orgSectionTitle`: Solo → Practice, Practice → Chambers, Firm → Firm). Sidebar, Topbar breadcrumbs, CmdK and SectionTabs all read it.
- Solo without a Munshi seat: Team Chat hidden (Sidebar passes `hasTeam` = billing `munshiSeats > 0`; other callers default to hidden on Solo). Direct URL still works.
- Settings: neutral profile sentence; org row labelled Practice / Chambers / Firm.
- Feature grants unchanged (server permissions untouched).

## Impact map
- Sidebar, Topbar, CmdK, SectionTabs (nav-config), SettingsView. No API/DB change.

## Edge cases
- Billing still loading → Solo hides Team Chat until munshiSeats is known (appears if > 0).
- A Munshi member on a Solo firm: same billing data → Team Chat shown.

## Acceptance criteria
- AC1 Solo: section + breadcrumbs say "Practice", never "Firm".
- AC2 Practice plan "Chambers"; Firm plan "Firm".
- AC3 Team Chat hidden on Solo without a Munshi seat; shown with one and on team plans.
