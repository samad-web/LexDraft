# Review copy: pen marks + margin notes (review-copy)

**Status:** BUILT 2026-11-25 (owner: "yes proceed", all four recommendations). Not deployed; migration 0123 local only.

**Built differently from the first draft of this doc:** the notes page is plain paragraphs (LibreOffice added its own list numbers to `<ol>`, giving "1. 1."). A teammate sees a review read-only; only the author saves it to Documents.

## Purpose
An advocate reads a draft line by line and wants to circle, strike, underline or write over it with an iPad + Apple Pencil, and jot notes in the margin, on a duplicate, so the draft itself is never disturbed. The same for papers in a case (e.g. the other side's petition).

## Owner decisions (2026-11-25)
1. A saved review is visible to the whole firm (a junior can make the corrections); only its author changes or deletes it.
2. Typed margin notes have **Send to Redraft** (normal Redraft credits; exact edits stay free as today).
3. Ink: black, blue, red, yellow highlighter (the advocate's own marks; the app's UI stays black and white).
4. Works on drafts (Draft page) and on uploaded PDF/Word files in case Documents.

## What the advocate sees
- Draft page: **Review copy** (saved drafts). Case → Documents: **Review** on PDF/Word files.
- A full-screen review page: the frozen pages, a toolbar (Pen, Highlighter, Eraser, Note, colours, Undo/Redo, "Draw with finger"), and a notes column.
- Apple Pencil draws; a finger scrolls; a resting palm never marks. Mouse draws on a computer. "Draw with finger" for phones without a stylus.
- Note tool: tap a line → a numbered pin there + a note in the column (type or dictate). On a draft's review: **Send to Redraft** opens the draft with Redraft run on that paragraph.
- Saves itself as you go. **Save to Documents** writes "<title> (review, 25 Nov 2026)" as a PDF (marks drawn in, a numbered notes page at the end) into the case's Documents: viewable, shareable, one row per review (replaced on each save).
- If the draft changed after the review copy was made: a banner "The draft has changed since this review copy" + **New review copy**.

## Architecture
- **Table `document_reviews`** (migration 0123, additive): id, firm_id, user_id (author), case_label, title, source ('draft'|'document'), draft_id, source_document_id, source_updated_at, snapshot_key (the frozen PDF, encrypted storage), page_count, marks jsonb, notes jsonb, result_document_id, created_at, updated_at.
- **Marks** are vectors in page-relative units (0-1), so they scale on any screen: `{ pages: [{ strokes: [{ tool:'pen'|'hl', color, w, pts:[[x,y,p]...] }] }] }`. Notes: `[{ id, page, y, text, excerpt }]` (excerpt = the line's text from the PDF, for Redraft).
- **API** (`routes/reviews.routes.ts`, `services/reviews.service.ts`, no model calls):
  - `POST /reviews` from a draft `{ draftId?, title, matter, pdfBase64 }` (the Draft page's own `draftPdfBlob`, the same PDF as Download PDF) or from a document `{ documentId }` (PDF copied; .docx/.doc converted by LibreOffice).
  - `GET /reviews/:id` (+ `/pdf` for the snapshot), `GET /reviews?draftId=|caseLabel=`, `PUT /reviews/:id` (marks/notes, author only), `POST /reviews/:id/export`, `DELETE /reviews/:id` (author only).
  - Export: pdf-lib draws the strokes as paths (highlighter at 35% opacity) and the note pins; the notes page is HTML → LibreOffice PDF (Noto fonts, so Tamil/Hindi notes print), appended with pdf-lib.
- **Web**: `views/ReviewView.tsx` (`/app/review/:id`), `components/review/ReviewPage.tsx` (pdfjs page + ink canvas), `lib/review-ink.ts` (pure: input routing/palm rejection, stroke building, hit-test for the eraser, undo stack).
  - Pencil: Pointer Events (`pointerType:'pen'`, pressure); `touchstart` with `touchType:'stylus'` is preventDefault-ed so the Pencil never scrolls while fingers still do.

## Impact map
- `document-render.service.ts`: exports `convertToPdf` (docx/doc/html → pdf, same lock + timeout). PDF preview/download unchanged.
- `DraftingView.tsx`: Review copy button; incoming `state.redraftNote` → Redraft request (focus on the matched paragraph). `RedraftRequest.source` widens to 'review' | 'advocate'.
- `DraftRevisePanel.tsx`: passes 'advocate' through (server already accepts it).
- `CaseDocumentsPanel.tsx`, `DocumentsView.tsx`: Review button; a review's exported PDF row gets "Open review" via `reviewId` on the Documents list (`listWithDrafts` maps it).
- `App.tsx`: one route. No change to drafts, documents, credits.

## Edge cases
- Unsaved or edited draft: Review copy saves it automatically first (owner 2026-11-25), so the review matches the saved draft; a failed save shows the usual error and makes no review.
- Snapshot over 15 MB or not a PDF: refused. Word file LibreOffice can't convert: "couldn't make a review copy of this file".
- Another firm's review/document: 404. A team member opening someone's review: view only (toolbar hidden), can still export? No: only the author saves to Documents.
- Concurrent saves from two tabs: last write wins (marks are the author's own).
- Very long stroke / huge marks: cap 5,000 strokes per review, 2,000 points per stroke, body ≤ 5 MB.
- Notes over 2,000 characters each, 200 notes per review: refused.
- Source document deleted later: the review keeps its own snapshot copy and still opens.
- Engine/LibreOffice down at export: the marked PDF is still saved without the notes page; the advocate is told.

## Acceptance criteria
1. From a saved draft, Review copy opens the same pages as Download PDF; the draft is unchanged after any marking.
2. Pencil draws, finger scrolls, palm doesn't mark; mouse draws; "Draw with finger" draws with a finger.
3. Pen/highlighter colours, eraser (whole stroke), undo/redo work; marks stay put after zoom/resize and on another device.
4. Marks and notes survive a reload (saved automatically).
5. Save to Documents creates one PDF row in the case (re-saving replaces it) with the marks drawn and a notes page (Tamil text readable).
6. Send to Redraft opens the draft and runs Redraft on the noted paragraph.
7. A teammate can open and view the review but not change it.
8. From a case's PDF/Word document, Review works the same (no Redraft).
9. The draft-changed banner shows after the draft is edited and saved.
