# PLAN — eFiling redesign in DifAi's design (awaiting approval)

## Goal and scope
- Redesign the whole logged-in and logged-out eFiling experience (`/app/efiling`) in DifAi's Chambers design (`apps/web/src/styles/CHAMBERS.md`), organised the way an advocate works, not the way the portal's menus are laid out.
- Same data and behaviour: every screen still reads the advocate's live filing.ecourts.gov.in account; every portal action keeps its confirmation; captcha/OTP typed by the advocate; the portal → DifAi sync stays.
- Out of scope: API/service changes (only if a screen needs data it doesn't get today), new portal actions, the marketing site, the rest of DifAi, deploy.

## Project memory that applies
- Strictly black and white; red only as a button naming a mandatory issue (e.g. "Cure 1 objection"). Light + dark.
- 2026-11-03: eFiling fully in DifAi design; replaces the 2026-11-02 portal-copy layout (portal chrome clones go).
- No live DB changes; no test accounts; deploy only on "deploy".

## Feature list (prioritised) — detail in `features/efiling-redesign.md`
1. **Shell + navigation + Sign In** — PageHeader "eFiling" with a connection chip; `PillNav` sections; Sign In as a centred DifAi card.
2. **Overview** — stat cards (serif figures), "Needs attention" (objections as red named buttons), hearings calendar + today's listings, sync status.
3. **Filings** — one table of every filing (portal drafts, eFiled, completed pleadings, prepared in DifAi) with status chips, search and filters; a filing opens a side panel with Documents / Status / Court fee / Oath / History and the PDFs.
4. **Cases** — My Cases (group by district/date; pending/disposed), case detail, Search Cases, Planner, Import/Export.
5. **Forms** — New filing (stepper), Pleadings, Payments, Applications, Vakalat & Partners in one form system (sections, 2-column fields, one primary action).
6. **Cleanup** — remove PortalChrome, efiling-portal.css and portal-copy styling; shared pieces reduced to Chambers primitives.

## Build order
1 → 2 → 3 → 4 → 5 → 6. Each step: implement, update tests (UI selectors), run all eFiling suites, screenshot light/dark/phone, commit `feat(efiling-redesign): …`.

## Open question for approval
- Section names/grouping in feature doc §Navigation — confirm or adjust before step 1.
