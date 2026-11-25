# Word files open on screen (document-preview)

**Status:** BUILT 2026-11-25 (owner: "documents are not able to open in the system; only uploading and WhatsApp sharing"). Not deployed; no migration.

## Cause
The document viewer could show PDFs and images only. A Word file (.docx / .doc) showed "Inline preview isn't available… Use Download original", leaving Download and WhatsApp. Prod log: the owner opened a .docx from Safari on a Mac (download-url 200, no file fetched: the viewer never tries to show Word).

## Fix
- API `GET /api/documents/:id/preview` (`shared.documents`, firm-scoped): a PDF as it is; a Word file converted to PDF by LibreOffice (same converter as drafts, with the cold-start retry). Other types / unreadable Word: 422 `preview_failed` (the viewer keeps its Download message). No model call.
- Viewer: for Word files it fetches the preview and shows it exactly like a PDF (PDF frame where the browser has a PDF viewer, drawn pages elsewhere: iPhone / iPad / Android). "Opening the Word file…" while it converts. Sharing, the PDF password lock and Download still use the original Word file (`showAsPdf` is display only).

## Acceptance
1. A .docx / .doc opens on screen on a computer, iPhone and iPad; Mark up is offered.
2. A PDF is unchanged; another firm's document: 404.
3. The PDF lock option stays PDF-only.
