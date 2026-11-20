# case-binder (Stage 1) — DRAFT

## Purpose
One indexed compilation of the judgments relied on, ready for court or the opponent.

## Architecture
- From a draft's verified authorities or Research "Add to binder": ordered list → one PDF with an index page (case, citation, paras relied on, page no.) + each judgment, relied paragraphs highlighted where text positions allow.
- Reuse the existing PDF / protected-PDF pipeline and Brief Packs; check overlap first (may become a Brief Packs option, not a new feature).
- A4 / legal size.

## Impact map
- PDF export, protected PDF, secure share links, Brief Packs credits (if charged), matter documents (binder saved to the matter, encrypted at rest).

## Edge cases
- Source PDF missing/unreachable → index entry marked, binder still built.
- Large binder (>300 pages) → background job, notify when ready.

## Acceptance criteria
- Index page numbers match the actual pages.
- Saved to the matter, encrypted, shareable by secure link.
