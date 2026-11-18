# Formats page (LAWE forms) — owner 2026-11-18

## Purpose
The 54 LAWE court forms were only reachable from Draft → Formats (a modal). Owner wants them as their own sidebar feature: view each form inside DifAi and download it blank as PDF or Word.

## Architecture
- Web only. New `views/FormatsView.tsx` at `/app/formats`; sidebar item "Formats" in Draft & AI after Clause Bank (`nav-config.ts`, `ROUTE_TITLES.formats`); route gated `drafting.ai` like the API.
- Reuses existing API: `GET /drafting/engine/library` (forms, grouped by LAWE section), `POST /drafting/engine/blank` (DifAi's own blank .docx), `POST /drafting/engine/docx-to-pdf`.
- View = PDF blob in an iframe inside a Modal, with Download PDF / Download Word. LAWE's own files are never served.

## Impact map
- nav-config (Sidebar, CmdK, SectionTabs read it), App.tsx routes. No API, DB or engine change. Draft-page modal unchanged.

## Edge cases
- Engine down / blank fails → toast "Could not prepare …", no viewer.
- Library empty or error → message / retry.
- Phone browsers that can't show PDFs inline → note + Download PDF.
- No drafting.ai → item hidden; direct URL shows the locked-plan screen.
- Prod check 2026-11-18: all 54 forms render blank (0 need case details).

## Acceptance criteria
- AC1 sidebar "Formats" (drafting.ai only) → /app/formats.
- AC2 forms grouped by LAWE section; search filters.
- AC3 View opens the blank form in-app with PDF + Word downloads.
- AC4 PDF / Word download straight from the list.
- AC5 failure shows a plain message.
