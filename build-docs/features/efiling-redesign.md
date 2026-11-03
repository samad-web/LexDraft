# Feature: eFiling redesign (DifAi design)

## Purpose
eFiling currently copies the portal's look (navy bar, A- A A+ bar, grey strips, portal form rows). It doesn't match the rest of DifAi, and it is weak on phones. Advocates should get DifAi's calm Chambers design, organised around their work: what needs attention, their filings, their cases, and the forms to file.

## Navigation (proposal — confirm)
`/app/efiling?s=<section>`; PillNav under the PageHeader:
| Section | Contains (today's screens it replaces) |
|---|---|
| Overview | Dashboard tiles, Calendar, Cases Listed Today, objections, sync status |
| Filings | Draft Pleadings, Completed Pleadings, Draft/eFiled Cases, Draft/Completed IAs, Objections lists, View Documents/View Status windows, Prepared in DifAi |
| Cases | My Cases, case details, Search Cases, Planner, Import/Export Cases |
| New filing | New Case Filing wizard (tabs → stepper), Manage Favourite Clients |
| Pleadings | Use Template, Pleadings (upload/index/eSign), Video Recording |
| Payments | Payment, transactions, Court Fee Wallet |
| Applications | IA Filing, Submitted Applications |
| Partners & Vakalat | Add/Accept/Revoke Partnership, Accept Revocation, Report, Assign Partners, Accept Offer, Print Vakalat |
Header right: connection chip ("eFiling · ask2gdr… · Tamil Nadu"), menu: Sync now, Portal session, Log out. Old `?m=` links keep working (mapped to sections).

## Architecture
- `views/EfilingView.tsx`: shell (PageHeader, chip, PillNav, section router). No PortalChrome.
- Sections as components in `components/efiling/sections/`; they reuse the existing hooks (`hooks/useEfiling.ts`, `hooks/efiling/*`) unchanged.
- Shared UI from Chambers: `PageHeader`, `.card`, `.tbl`, `PillNav`, `Modal`+`Field`, `.chip`/`.badge`, `EmptyState`, `.btn*`, `.input`. `PortalKit`/`PortalForm` shrink to thin wrappers over these (live-screen renderer for the generic portal screens stays, restyled).
- Styles: `styles/chambers/court.css` (scoped `[data-ui='chambers'] .efiling`). Tokens only.
- No API or DB change expected.

## Impact map
- `EfilingView.tsx` (shell, routing, Overview, My Cases window) — biggest change.
- `components/efiling/PortalChrome.tsx`, `styles/efiling-portal.css` — removed.
- `PortalKit.tsx`, `PortalForm.tsx` — restyled; used by all five module screens.
- `portal/PortalCaseFiling|Pleadings|Epay|Applications|Vakalat|Partners|Portfolio.tsx` — re-laid out; logic unchanged.
- `PortalLoginPanel.tsx` — Sign In card; flow unchanged.
- `PortalSync.tsx`, `CaseFilingHistory.tsx` (case page) — restyle only.
- Tests: `e2e/efiling-login-ui.e2e.ts`, `e2e/efiling.e2e.ts` (UI selectors), `e2e/efiling-preview.e2e.ts` (screen list). Service-level suites unaffected.
- Risk: links/notifications using `?m=` / `?filing=` (keep mapping); keyboard/focus in modals; dark mode.

## Edge cases and failure modes
- Not logged in / "Prepare without logging in": sections that need the portal show a Sign In prompt card; DifAi-only sections work.
- Session lost mid-use (410/404): back to Sign In with the reason, as today.
- Empty lists: `EmptyState` per section; portal slow: skeleton + "Reading from filing.ecourts.gov.in…".
- Long tables / many columns: scroll inside the card, never the page; `.tbl` stacks on phones.
- Destructive / irreversible actions (submit, eFile, pay, delete, accept, revoke): confirmation modal with the portal's wording, unchanged.
- Security: no credential storage changes; captcha/OTP still typed by the advocate.

## Acceptance criteria
1. No portal-copy chrome remains (no A- A A+ bar, navy bar, "eFiling Services" block, grey Help strip, hex colours) — grep shows no hex in eFiling files.
2. Every section renders in light and dark and at 360px / 768px / 1440px with no sideways page scroll; tap targets ≥ 40px on phones.
3. One primary button per area; red only for "Cure N objection(s)".
4. All existing behaviour reachable: every current screen maps to a section (table above); old `?m=` links open the right section.
5. All eFiling e2e suites pass (selectors updated, assertions kept); preview screenshots from real captured data reviewed for every section.
