# Mark up case files and paper (case-markup)

**Status:** BUILT 2026-11-25 (owner: "both" = photos/scans of paper AND a blank sheet). Not deployed; no migration.

## Purpose
Documents uploaded to a case (including photos of paper notices and orders) should open straight into the pen screen, and advocates want a blank sheet to write on with the Apple Pencil.

## What the advocate sees
- After uploading a PDF, Word file or photo: **Mark it up now?** → **Mark up now** opens the pen screen (or **Later**).
- Document viewer (tap a file): **Mark up** next to Share and Download.
- Case → Documents: **New handwritten page** (a blank A4 sheet, filed with the case); select several files → **Mark up N together** (one set of pages, in order).
- Pen screen: **Add page** adds a blank page at the end of any review (more paper).
- iPhone photos upload as JPEG (the picker no longer asks for HEIC, so iOS converts). A HEIC already uploaded gets clear advice instead of an error.

## Architecture (no migration)
- `services/review-pages.ts`: `imageKind` (from bytes), `jpegOrientation` (EXIF tag 0x0112), `imageToPdf` (JPEG/PNG → an A4-wide page, turned upright for orientation 3/6/8), `mergePdfs`, `blankPdf`, `appendBlankPage`.
- `reviews.service`: `asPdf` (PDF as is; Word / WebP / TIFF via LibreOffice; JPEG / PNG via pdf-lib; HEIC refused), `fromDocuments` (≤ 20 files), `blank` (source 'document', no source file), `addPage` (author only, ≤ 200 pages; replaces the snapshot, marks on earlier pages unchanged).
- `POST /reviews` accepts `{ documentIds }` and `{ blank: true, matter }`; `POST /reviews/:id/pages`.
- Web: `NewDocumentModal` (accept list without .heic; Mark up now), `DocumentViewerModal` (Mark up), `CaseDocumentsPanel` (New handwritten page, Mark up together), `ReviewView` (Add page), `lib/review-copy` (photos reviewable; helpers; error texts).

## Impact map
- `NewDocumentModal` is used on the Documents page and in cases: both get "Mark up now". Removing `.heic` from the picker affects all uploads (iOS sends JPEG; a desktop HEIC can still be dragged in, and gets the advice if marked).
- `convertToPdf` accepts webp/tiff (same LibreOffice path).

## Edge cases
- pdf-lib reads a Buffer's underlying memory: small Node Buffers share a pooled one, so images are copied first (found by tests).
- Mirrored EXIF orientations count as their turn. A broken photo → "Couldn't make a review copy".
- Selection may mix PDFs, Word and photos; non-markable files in the selection are left out.

## Acceptance criteria
1. Uploading a PDF / Word / photo offers Mark up now, which opens the pen screen.
2. The viewer has Mark up.
3. A phone photo of a paper notice opens upright as a page.
4. Several selected files open as one review, in order.
5. New handwritten page opens a blank A4 sheet in the case; Add page adds more; Save to Documents files it in the case.
6. A HEIC photo gets clear advice; the uploaded file is never changed.
