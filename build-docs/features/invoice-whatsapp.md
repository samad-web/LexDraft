# Feature: Send the GST invoice on WhatsApp after payment

> Updated 2026-11-17 by signup-hardening.md: the recipient must have an OTP-verified number (`phone_verified_at`), like plan-active.

Status: **LIVE 2026-11-17 (578fc3d, 0115 applied, template switched on).** Owner decisions (2026-11-17): link now, PDF later; Claude creates the template via Wasi API.
- Found: Wasi ignores per-message media; a DOCUMENT template always sends its one stored sample (and `invoice_document`'s sample has expired on Meta). `header` is a ≤60-char text field. So `invoice_document` can't carry each customer's PDF yet.
- Built instead: new Utility template **`difai_invoice`** (created via Wasi API 2026-11-17, Meta-approved the same day): "Hi {{customer_name}}, thank you for your payment. Your DifAi GST invoice {{invoice_number}} for {{invoice_amount}} dated {{invoice_date}} is ready here: {{invoice_link}} … This link works for 7 days …" + URL button "Open Plan & Billing". Wasi dropped the footer.
- Link = `/api/i/<32-char token>`, **7 days** (not 24 h: the message promises 7). Env `WHATSAPP_INVOICE_TEMPLATE=difai_invoice` turns it on (empty = off).
- One real test sent to the owner's 8754258581 on 2026-11-17 (Meta status sent).
- Later: when Wasi accepts a per-message document link, attach the PDF instead.

## Purpose
- Owner: after a payment, the GST invoice reaches the buyer on WhatsApp, through the same sender as the sign-up OTP.

## How the OTP goes today (found 2026-11-17)
- `services/whatsapp.service.ts` → Wasi Hub `POST https://wasi.sirahagents.com/api/v1/messages`, Bearer key, body `{client_id, to, type:'template', template:'lexdraft_otp', params:{'1': code}}`.
- Sender: Wasi client `00000000-…-0001` = +91 73395 61631. Key only in prod `.env.docker` / local `apps/api/.env`.
- A business-started WhatsApp message must use a Meta-approved template; the OTP uses an Authentication template.

## Template (already approved on the same sender)
- `invoice_document`, Utility, en_US, header **DOCUMENT**, body: "Hi {{customer_name}}, please find attached your invoice {{invoice_number}} dated {{invoice_date}}. Reply here if you have any questions about this bill.", footer "-Sirah Digital", quick reply "Received".
- No new Meta approval needed if we reuse it.

## Architecture
- Trigger: one place, right after `subscriptionInvoiceService.issueForPayment` creates a new invoice (covers Razorpay plan payments, Brief Packs, custom plans, paid credit top-ups). Queued as a pg-boss job (`invoice.whatsapp`), so a WhatsApp outage never delays or breaks the payment; retried 3× with backoff.
- Recipient: the account owner's verified WhatsApp number (`users.phone`, verified by OTP at sign-up). No number → skipped, logged; the invoice stays downloadable in Plan & Billing as today.
- Attachment: WhatsApp fetches a document header from a link. A one-time, 24-hour, unguessable URL `/api/i/<token>` serves only that invoice PDF (sha256 of the token stored, like share links); nothing else is reachable from it.
- `whatsappService.sendTemplate({to, template, params, document})` added beside `sendOtp` (same provider switch).
- Record per invoice: `subscription_invoices.whatsapp_sent_at`, `whatsapp_error` (migration 0115, additive). Admin Firm page shows "Sent on WhatsApp ✓ / failed (reason) · Resend".

## Impact map
- `subscription-invoice.service.ts` (enqueue after insert), `whatsapp.service.ts` (new sender fn), `jobs.service.ts` (job), new public route `/api/i/:token` (rate-limited, no auth, PDF only), admin Firm payments card (status + resend), migration 0115.
- Privacy: invoice holds buyer name, GSTIN, address → goes only to the owner's own verified number; link expires in 24 h.

## Edge cases
- Duplicate webhook → invoice is idempotent, so one message.
- ₹1 test invoices → sent too (owner can see it work).
- Wasi/Meta rejects (number not on WhatsApp, template paused) → error stored, admin can resend.
- PDF render fails → job retries; after 3 failures error stored.

## Acceptance criteria
1. A completed payment sends exactly one `invoice_document` message with the PDF to the owner's verified number.
2. Payment success never depends on WhatsApp (outage → payment + invoice still done).
3. No phone → no send, clear status in admin.
4. Link serves only that PDF, only for 24 h; wrong/expired token → 404.
5. Admin sees sent/failed per invoice and can resend.

## Open questions for the owner
- Wasi's exact request format for a template **document header** (link field name, filename) — not in the repo, no public docs.
- OK to send one real test message to the owner's own number before go-live?
