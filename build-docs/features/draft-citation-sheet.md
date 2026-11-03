# draft-citation-sheet

## Purpose
Check a cited section while reading a draft on a phone, without leaving it.

## Architecture
- Draft viewer marks citations already present in `lib/draft-blocks.ts` as buttons (chip style, ink outline).
- Tap → bottom sheet (existing Modal as sheet on ≤640 px) showing the section text via `useLawsSearch` / the same source as `LawSidePanel`, plus BNS↔IPC concordance when relevant. "Open in Research" link.
- Desktop keeps the existing `LawSidePanel`.

## Impact map
- DraftingView, draft-blocks.ts (citation spans), LawSidePanel/useLawsSearch (reuse), Modal (sheet variant), offline cache (sheet shows "Needs connection" offline).

## Edge cases
- Citation not found in laws DB → "Not in DifAi's statute set — verify manually" (never invent text).
- Ambiguous (e.g. "s. 138") → resolve with the draft's act; else list matches.

## Acceptance criteria
- Every recognised citation in a sample s.138 notice opens its section; unknown ones show the verify message; sheet closes with back button and swipe-down; focus returns to the chip.
