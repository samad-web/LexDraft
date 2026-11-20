# citator-v1 (Stage 1) — DRAFT

## Purpose
"Is this still good law?" — the check advocates pay research tools for.

## Architecture
- At ingest, extract citations from each judgment's paragraphs (reuse `lib/judgment-parse.ts` / draft-guards parser) → `judgment_citations(citing_id, cited_id, para_seq)` (new additive migration).
- "Cited by N" list on a judgment, newest first, with the citing paragraph.
- Warning when the citing paragraph has overruled / not good law / per incuriam / distinguished / doubted near the citation → "Possible negative treatment — read para X". Never states "overruled" as fact.
- Shown in Research and on verified citations in drafts.

## Impact map
- New table + migration (owner's go), ingest scripts, `judgments.service.ts`, Research view, draft citation chips. Covers only courts in our corpus — UI says so.

## Edge cases
- Cited case not in corpus → keep raw citation text, link when ingested later.
- Same case under different reporters → dedupe.
- Bench-strength subtleties → out of scope; wording stays "check".

## Acceptance criteria
- Hand-checked set of 30 SC cases (known overruled + known good): warnings on the overruled ones; false-warning rate recorded in TESTING.md.
- Coverage note always visible.
