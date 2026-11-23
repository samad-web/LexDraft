# Open and edit your own document (import-edit-document)

**Status:** BUILT 2026-11-23 (owner approved; Option A = separate copy per case). Not deployed; migration 0122 local only.

## Purpose
Advocates draft in MS Word outside DifAi. They want to open that file in DifAi, edit it there for one client's case, for several cases, or for no case, and download it with their own layout kept.

## What the advocate sees
- **Draft page:** a new **Open a document** button next to My drafts / Formats. The advocate picks a file and a case (or "No case"), and it opens in the editor.
- **Case → Documents:** a new **Edit in DifAi** button on uploaded Word and PDF files. The case is already known.
- **Saved draft:** **Copy to another case** makes an independent copy (document + its original file) in the chosen case (Option A). **Add to a case** files a "No case" draft into a case.
- **Documents section (owner 2026-11-23: "pushed to the document section correctly"):** each imported document shows as exactly two real files, in Documents (all) and in the case's Documents tab:
  - **`<name> (original)`**: the upload, never changed.
  - **`<name>`**: the edited Word file. It is **re-filed on every save** (same row, file replaced, never a new row per save). It can be viewed, shared (WhatsApp / secure link), downloaded and is visible to the whole firm, like any uploaded document.
  - The editable draft behind it is not listed separately (no duplicate "draft" row). **Edit** on the edited file opens it in the editor.
  - A **document type** (Petition, Plaint, Written statement, Notice, Affidavit, Agreement, Other) is picked when opening, so the file lands in the right folder / filter.
  - A teammate who taps Edit in DifAi on the edited file gets their own draft from it (drafts stay per user; nothing of theirs is overwritten).
- Opening, editing, saving and downloading are free (no AI). Redraft, Check what's missing and Translate cost credits as they do today.

## Decisions (proposed defaults, confirm with the plan)
- File types: .docx; .doc (converted to .docx by LibreOffice on the server); PDF as **"Import text from PDF"** (text only, layout not kept, scans via OCR).
- Edits written back into the advocate's own .docx even when paragraphs are added or deleted (engine fix below).
- The original upload is never changed. Edits live in the draft. Every case copy has its own original file.
- Not in v1: "Save as case notes" (owner to clarify what "notes" means), editing headers/footers/footnotes/text boxes, tracked changes, .odt/.rtf.

## Decisions made while building
- **Tracked changes block opening** (was a warning): python-docx skips `w:ins` text, so an edit would duplicate it. Message: "Review → Accept All Changes, save, open again".
- **The server builds the edited Word file** from the edited lines (`PUT /drafts/:id/edited-file {paragraphs}`): apply-edits into the original (.doc converted), else a house-style .docx via the engine's compose-docx. The browser's generic export is an HTML ".doc", not a real Word file, so it is not used for Documents.
- **PDF imports get a house-style .docx at open** (compose-docx), so downloads are real Word files too. Text only; the PDF layout is never kept.
- **`/engine/apply-edits` moved from drafting.ai to drafting.basic**: no model call, so Munshi seats can download edited files with their layout.
- **Alignment read from XML** (`tables.paragraph_align`): LibreOffice and newer Word write `w:jc="start"/"end"`, which python-docx 1.2 raises on. Found by the local end-to-end run (.doc converted by LibreOffice failed). Same output as before for engine drafts.
- **"Add to a case"** = pick the case in the Draft page's case picker and save (PATCH /drafts/:id/matter runs before the file is filed). An original that lives in another case's file is never moved.
- **"Copy to another case"** shows on every saved draft (an ordinary draft is copied without files).
- Loading any saved draft clears the previous draft's Word file (was kept: downloads could merge into the wrong file).

## Architecture
**Engine (stateless, no AI)**
- `POST /v1/read-docx {docx_base64}` → `{blocks}` using the existing `_extract_blocks`. No engine tidy or renumbering on a user's file.
- `apply_edits` alignment: diff old lines against edited lines (difflib). Equal lines are kept. Changed lines are set in place. An inserted line clones the format of the paragraph before it (or the table row). A deleted line removes its paragraph or row. `matched:false` only when the file can't be mapped. This also improves engine drafts.
- Both engine copies are mirrored (repo `lexdraft-engine` + OneDrive running copy).

**API**
- `POST /drafting/document/open` takes either `{documentId}` (a firm's case document) or `{fileName, fileBase64, matter?}` (a new upload, at most 8 MB).
  - Magic-byte check: docx = zip with `word/document.xml`, doc = OLE header, pdf = `%PDF`. Reject .docm and password-protected files.
  - .doc → soffice → .docx. docx → engine read-docx. pdf → `extractText` (pdf-parse/OCR).
  - A new upload is stored first as an encrypted `documents` row (case label = matter, or empty for No case).
  - Returns `{blocks, docxBase64|null, sourceDocumentId, kind:'docx'|'pdf', warnings[]}`.
  - Per-user limit of 20/hour (same as document reads). `requireFeature('drafting.basic')`.
- Migration **0122** (additive): `drafts.source_document_id` and `drafts.edited_document_id`, both `uuid null references documents(id) on delete set null`.
- Save of an imported draft: the draft saves as today, then the web sends its edited lines to `PUT /drafts/:id/edited-file`. The API builds the Word file (see decisions), stores it encrypted in the `edited_document_id` row: created on the first save, file replaced afterwards (new key read back first, then the old blob deleted). If that step fails the draft is still saved and the advocate is told to save again; until then the list shows the draft row.
- `GET /documents`: drafts with `edited_document_id` are left out of the draft list. The edited file row carries `draftId` (owner only) so Edit opens the draft.
- `/drafts/:id/matter {matter}` (Add to a case): moves the draft + both files to the case together.
- `GET /drafts/:id` loads the source .docx when `source_document_id` is set, so a reopened draft still downloads with its layout.
- `POST /drafts/:id/copy {matter}` creates a new draft row and new `documents` rows holding copies of the original and the edited file, filed in the target case. The target case must belong to the firm.

**Web**
- `OpenDocumentModal` (file + case picker incl. "No case").
- `openDocumentInEditor` in DraftingView, modelled on `openBlankInEditor`: it sets `engineDocxBase64`, `sourceDocumentId` and `draftCase`, and opens in Edit mode.
- Save sends `sourceDocumentId`.
- `CaseDocumentsPanel`: Edit in DifAi → `/app/draft` with `state.openDocumentId`.
- My drafts / Export card: Copy to another case, Add to a case.

## Impact map
- `lexdraft-engine/src/service/apply_edits.py`: used by every engine draft download. The alignment change must keep today's output for equal counts. `tests/service/test_apply_edits.py` line 39 expects `matched:false` on an added paragraph; that test encodes the old rule and gets updated (requirement changed). `test_evidence_tables.py` must still pass.
- `lexdraft-engine/src/service/app.py`: new route only.
- `apps/api/src/routes/drafting.routes.ts`: new route; the `/engine/apply-edits` route stays the same.
- `apps/api/src/services/drafts.service.ts`, `drafts.routes.ts`, `packages/types` `SavedDraft`/`SaveDraftRequest`: new optional `sourceDocumentId`. Old drafts are unaffected (null).
- `documents.service.ts`: reuse `create` (encrypted) + `getStorageKey`/`getObject`. Firm scoping on every `documentId`.
- `document-render.service.ts`: expose the soffice runner for .doc → .docx (same timeout + temp-dir cleanup).
- `DraftingView.tsx` `saveDraftToCaseDocuments`: must **skip** imported documents. Otherwise every save files the unedited original into the case again.
- `CaseDocumentsPanel`, `DocumentsView`: new button. "No case" files use the existing `-` case label (same as unfiled drafts). Edit on an edited file → its draft. Delete on an edited file asks and also removes its draft; delete on the original leaves the edited file (its download then uses the generic export).
- `documents.routes.ts` GET `/`: the draft/file de-duplication + `draftId`. `DocumentRecord` type: optional `draftId`.
- Pre-existing, not in this feature unless the owner says: `saveDraftToCaseDocuments` adds a NEW Documents row on every save of an engine draft (duplicates), and it files the unedited engine .docx.
- Credits / AI quota: no change (no model calls). DB: one additive column.

## Edge cases and failure modes
- Wrong or renamed file type, .docm, password-protected, or empty document → clear message, nothing stored.
- Zip bomb: cap the uncompressed size (50 MB) before parsing. XXE: confirm the python-docx parser does not resolve entities. Macros are never run (convert only).
- Tracked changes → refused with "Review → Accept All Changes first" (editing would duplicate them). Comments are kept but not shown.
- Word auto-numbering: the numbers don't show in the editor but are kept in the download (warn once).
- Legacy Tamil fonts (Bamini/Vanavil etc., not Unicode) show as garbled text → detect and warn. Unicode Tamil is fine.
- Headers/footers, images, stamps, footnotes, text boxes: kept in the download, not editable (warn).
- Over 5,000 paragraphs or 8 MB → refuse with a message.
- Scanned PDF: OCR can misread; warn "check every name, date and amount".
- Source document deleted later → the draft stays editable; the download falls back to the generic export (toast).
- documentId from another firm → 404. Copy to a case outside the firm → 404.
- Engine or soffice down → 503 "couldn't open the file right now"; the uploaded original stays in Documents.
- Two tabs saving the same draft: last save wins (unchanged behaviour).

## Acceptance criteria
1. A .docx with headings, bold, tables, header/footer and a logo opens in the editor with headings/bold/tables shown, from both the Draft page and Case → Documents.
2. Editing words, adding 2 paragraphs and deleting 1, then downloading Word → header, footer, logo, margins, fonts and untouched paragraphs are identical; new paragraphs carry their neighbour's format.
3. A .doc opens the same way. A PDF opens as text with the "layout not kept" note.
4. After saving, Documents (all) and the case's Documents tab show exactly `<name> (original)` and `<name>`, in the folder of the chosen type. Saving 5 times leaves still 2 rows, and the edited file always holds the latest save. Both can be viewed, shared and downloaded, and a teammate in the firm sees both. "No case" files show in Documents with "-".
5. Copy to another case → an independent draft + original file in case 2; editing one never changes the other.
6. Add to a case moves a No-case draft into a case.
7. Reopening a saved imported draft still downloads with the original layout.
8. No model call and no credit change for open/edit/save/download.
9. Bad, encrypted, oversized, other-firm and engine-down cases give the messages above, with no partial rows left behind.
10. Existing engine draft downloads give byte-equivalent output for equal-count edits (regression).
