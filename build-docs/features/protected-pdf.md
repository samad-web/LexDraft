# Password-protected PDF

## Purpose
A PDF sent on WhatsApp or downloaded can be forwarded and read by anyone. A password lock keeps a forwarded copy unreadable.

## Architecture
- API `POST /api/documents/protect-pdf` (signed-in, firm-scoped): body = PDF (raw, ≤25 MB) + password + watermark text. Returns the locked PDF.
  - Watermark: pdf-lib (already installed) stamps light grey "Confidential – for <client> – <date>" on each page.
  - Lock: `qpdf --encrypt <pw> <owner-random> 256` (AES-256). Add `qpdf` to the api Dockerfile apk line. Temp files in a private tmp dir, deleted in `finally`.
- Web: "Lock with password" checkbox on the Draft Share card and on the document Share/Download menu. Password field pre-filled with a random 6-digit PIN (advocate can type their own, min 4 chars). Not the client's mobile: anyone the file is forwarded to in WhatsApp can see that number. Note in the WhatsApp text: "Password: sent separately" (we never put the password in the same message).
- Reuses shareFile / download paths from 372a7c2.

## Impact map
- Draft Share card, documents list share/download, WhatsApp share (f62cc44).
- api Dockerfile (new apk package), image size +~2 MB.
- No DB change. Password never stored or logged.

## Edge cases
- Password < 4 chars → refused. Not a PDF / already encrypted / corrupt → 400 with a clear message.
- Word (.docx) files: not lockable this way → button disabled with "PDF only".
- Big PDF (25 MB) → same cap as uploads.
- qpdf missing (dev machine) → 503 "Password lock not available", share still works unlocked.

## Acceptance criteria
- Locked PDF needs the password to open (qpdf --check / pdf-lib load fails without it), opens with it, same page count.
- Watermark on every page.
- Password absent from logs and responses; temp files removed.
- Wrong input → 400; feature off for users without document access.
