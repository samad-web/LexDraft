# Save as case note (save-as-case-note)

**Status:** BUILT 2026-11-23 (owner: "yes proceed"). Not deployed; no migration.

## Purpose
An advocate editing a document (their own, or a DifAi draft) wants to keep its text as a note on one or more cases. Today notes accept an upload or typed text, but there is no one-tap way from the editor, and old .doc files are refused.

## What the advocate sees
- Draft page, next to Save: **Save as case note**. A dialog lets them pick one or more cases and **Shared with the team** or **Only me**.
- Each chosen case gets its **own, separate note** (Option A, same as documents): editing or deleting one never touches another.
- Case → Notes → upload now also accepts **.doc**.
- Shown in the dialog: notes are text only (no Word layout), and AI drafting for that case reads its notes, so keep notes short. Full documents belong in Documents.

## Architecture
- **Web only for the button:** `SaveAsNoteModal` loops over the chosen cases and calls the existing `POST /case-notes` (typed note: title = document title, body = the editor's plain text, visibility). No new endpoint or table. Permission: the existing `matter.notes.create` (button hidden behind `Gate`).
- **.doc in notes:** `lib/text-extraction.ts` gains a .doc branch (LibreOffice `convertDocToDocx`, then mammoth), and `SUPPORTED_NOTE_MIME_TYPES` adds `application/msword`. The Notes upload `accept` list adds `.doc`.

## Impact map
- `text-extraction.ts`: also used by case-document text for drafting, document Q&A and (parked) Matter Intel. They now read .doc as well; other types are unchanged.
- `case-notes.routes.ts` / `matter-intel.routes.ts`: zod enums built from `SUPPORTED_NOTE_MIME_TYPES`, so they accept application/msword.
- `DraftingView.tsx`: new button + modal. No change to saving drafts or documents.
- No migration, no credits (no model call).

## Edge cases
- Text over 50,000 characters (the note limit): refused before sending, with "keep it in Documents".
- Empty document: button disabled.
- No case picked: Save disabled.
- One case fails (deleted, no permission): the others still save; the message names the ones that failed.
- A .doc that LibreOffice can't convert: the note upload reports "couldn't read" as for any unreadable file.

## Acceptance criteria
1. Picking 2 cases + Shared creates 2 separate shared notes with the document's title and text.
2. Only me creates private notes (visible only to the author).
3. Over 50,000 characters is refused with the Documents advice; nothing is sent.
4. A partial failure reports which cases failed; the others are saved.
5. A .doc uploaded in Case → Notes is read into the note's text.
6. Other file types extract exactly as before.
