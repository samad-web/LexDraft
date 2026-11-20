# verified-citations (Stage 1) — DRAFT

## Purpose
No invented case law in a DifAi draft. `lib/draft-guards.ts` already extracts judgment citations and checks them against the corpus; make the result visible and enforceable.

## Architecture
- After drafting: each judgment citation → verified (in corpus, link + para) or unverified.
- Unverified = mandatory issue → red marker with "Replace with a verified case" / "Remove" / "I've checked it myself" (advocate's responsibility, logged).
- Word/PDF export warns if unverified citations remain.

## Impact map
- `draft-guards.ts`, `compose-authorities.ts`, drafting prompt (cite only supplied authorities), DraftingView citation chips (`lib/draft-blocks.ts`), exports, "Check what's missing", regional-language translate-last step (citations must survive translation unchanged).

## Edge cases
- Formats: SCC, AIR, SCR, neutral citations, "(2024) 3 SCC 1", case name only.
- One case, several reporters → one verified entry.
- Corpus off/unreachable → "not checked", never "unverified".

## Acceptance criteria
- Fixed set of real + fake citations: real found, fake flagged, 0 false "verified".
- Draft with a fake case shows the red marker; export shows the warning.
- Translated draft keeps citations identical.
