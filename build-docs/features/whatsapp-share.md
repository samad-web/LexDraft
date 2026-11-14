# Share on WhatsApp from documents, matters, hearings and invoices (approved 2026-11-14)

## Purpose
- Advocates send clients documents and updates on WhatsApp every day. Today only drafts (Draft screen), member invites and co-counsel links can be shared. User asked for documents and matters, plus anything else worth it.

## Scope
- Case documents: "Share on WhatsApp" in the document viewer. Files go as the file itself (device share sheet: phone app, Chrome/Edge); elsewhere the file downloads and WhatsApp opens with a covering note to attach it. Drafts in the viewer share their text.
- Matter: "Share update on WhatsApp" in the case page's More menu: title, case no./CNR, court (+ judge), stage, next hearing. Never notes, tasks, documents, fees or internal fields.
- Hearing (recommended): "WhatsApp" on each hearing in the diary day view: case, date, time, court, purpose - a client reminder.
- Invoice (recommended): "Share on WhatsApp" in the invoice detail: number, amount, issued/due dates.
- Every share is an explicit tap; WhatsApp opens with the text ready and the advocate picks the chat and presses send. DifAi sends nothing itself.
- Out of scope: sending from DifAi's WhatsApp number (Wasi) to clients - needs client consent + approved templates; client phone pre-fill (clients have no reliable phone field on the case).

## Architecture
- `lib/whatsapp-share.ts`: `openWhatsAppText(text)` (wa.me, length-capped), `shareFileOnWhatsApp(blob, fileName, note)` (wraps `native.shareFile`, falls back to download + wa.me), and pure message builders `caseUpdateMessage`, `hearingMessage`, `invoiceMessage`, `documentNote`.
- Draft screen's PDF share switches to the shared helper (same behaviour).

## Impact map
- `DocumentViewerModal.tsx` (footer), `CaseDetailView.tsx` (More menu), `DayHearingsModal.tsx` (row actions), `InvoiceDetailModal.tsx` (footer), `DraftingView.tsx` (refactor only). No API or DB change.
- Android app: wa.me opens the WhatsApp app; files use the existing Capacitor Share path.

## Edge cases
- Presigned file URL on another origin may refuse fetch (CORS) -> download the file and open WhatsApp with the note.
- Share sheet dismissed -> nothing happens, no error.
- Empty fields (no CNR, no next date, no judge) are left out, not printed as blanks.
- Very long text capped below WhatsApp's 65,536-character limit.

## Acceptance criteria
- Each builder outputs only the listed fields, skips empty ones, and never includes notes/internal data (unit tests).
- Buttons present on the four screens; type-check clean; existing share-file tests still pass.
