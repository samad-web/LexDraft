# judgment-research (Stage 1) — DRAFT

## Purpose
Advocates find authorities inside DifAi instead of paying for a second research subscription.

## Architecture
- Research tab gets a "Judgments" mode: `research.routes.ts` → `judgments.service` hybrid search.
- Filters: court, year range, judge, Act/section, party, case no., disposal. Sort: relevance, date.
- Results: paragraph hits with the court's para no., case title, date, court, source PDF link.
- Actions: "Use in draft" (adds to the draft's authorities), "Add to binder".
- AI summary of a judgment: optional, costs credits, cost shown before spending (credits-not-pages rule).

## Impact map
- `research.routes.ts`, Research view, drafts' authorities list, credits service (summary only), mobile layout ≤640 px.

## Edge cases
- Empty query / only stop-words → prompt, no search.
- No results → say so, suggest wider filters.
- Corpus switched off → mode hidden, not broken.
- Hostile query text → parameterised SQL only (test `orTsQuery` escaping).

## Acceptance criteria
- Each filter narrows results correctly (one test per filter).
- Para no. and PDF link shown on every hit.
- "Use in draft" adds the judgment and it shows as verified in the draft.
- Black & white UI; keyboard and screen-reader usable.
