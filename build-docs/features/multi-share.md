# Share several case documents on WhatsApp

## Purpose
From a case's Documents tab the advocate ticks some or all files and sends them to the client on WhatsApp in one go, with the password never skipped by accident.

## Architecture (web only; reuses existing APIs)
- CaseDocumentsPanel: a tick box per file row (files only; drafts without a file are not selectable) + "Select all" + a bar when ≥1 ticked: "Share N on WhatsApp".
- Share dialog:
  - Password: ON by default, random 6-digit PIN pre-filled, editable (4-64). Turning it off needs a second explicit tick ("Send without a password").
  - Way to send:
    1. Secure link (default): one link per file (existing /api/share-links), all with the same password, one WhatsApp message listing every file + link. Works for any file type and on every device.
    2. Files: device share sheet with all files attached. With password ON, each PDF is locked (existing /api/documents/protect-pdf) with the same PIN. Non-PDF files (Word, images) cannot carry a password: with password ON they block this option ("use Secure link for Word/image files"). Nothing goes out unlocked when a password was asked for.
  - After sending: the PIN is shown with Copy, and the message reminds the advocate to send it separately (call/SMS).
- Limits: up to 10 files per share; each ≤ 25 MB (existing caps).

## Impact map
- CaseDocumentsPanel.tsx (rows, selection state), new MultiShareDialog.tsx, lib/share-link.ts + lib/pdf-lock.ts (reused), whatsapp-share.ts (note text).
- No API or DB change. Share-link cap (200 active per firm) applies per file.

## Edge cases
- One file fails (lock or link) → stop, tell which file, send nothing partial for that share.
- Browser can't share files (Firefox desktop) → "Files" option disabled with a hint; Secure link still works.
- WhatsApp message length: 10 links fit easily (< 4 KB).
- Selection cleared when the filter changes or after sending.

## Acceptance criteria
- Tick some / all → one WhatsApp message with every selected file's link, or one share sheet with every file.
- Password ON by default; turning it off needs an explicit confirm; with password ON no file or link is ever created without it.
- Non-PDF + password + "Files" is blocked with a clear message.
