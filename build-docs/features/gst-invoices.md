# Feature: GST tax invoices for DifAi subscriptions

Status: **built 2026-11-13** (approved; seller details from Sirah Digital's GST certificate). Migration 0106 applied locally only. SAC 998315 is a placeholder until the owner's CA confirms; no phone printed. Depends on razorpay-billing (dc0ef6b, ec8d22d, 0c85977).

## Purpose
- Razorpay is a gateway, not a Merchant of Record: **Sirah Digital is the seller** and must issue a GST tax invoice for every subscription payment. (Owner, 2026-11-13: Sirah is GST-registered; invoices in DifAi's own format.)
- Firms can then claim input tax credit (ITC) with their GSTIN on the invoice.

## What exists (reuse)
- `billing.service.ts` webhook: `subscription.charged` fires for every successful charge (first and renewals) and carries `payload.payment.entity` (id, amount in paise).
- Buyer data from onboarding (0097): `users.gstin`, `address_line`, `pincode`, `state`, plus firm name, owner name, email and phone.
- Chromium in the API container (eCourts / Bar verification use Playwright): HTML → PDF with `page.pdf()`.
- `invoices.service.ts` is the advocate's own client invoices: a different thing, untouched.

## Architecture
- **Seller details (config, not code):** legal name, GSTIN, registered address, state + state code, SAC code, invoice prefix. Env `INVOICE_SELLER_*`, mirrored in the deploy env.
- **Migration 0106 (additive):**
    - `invoice_counters (fy text primary key, last integer)`: gapless numbering per financial year.
    - `subscription_invoices`:
        - Keys: id, `invoice_no` unique, fy, seq, firm_id, `razorpay_payment_id` **unique**, razorpay_subscription_id.
        - What was bought: plan, cycle, seats, period_start / period_end.
        - Buyer snapshot: name, practice, GSTIN, address, state + code, email, phone.
        - Seller snapshot (jsonb), place of supply.
        - Amounts in paise: taxable, cgst, sgst, igst, total. Plus sac and issued_at.
    - Snapshots keep an invoice unchanged forever, even after the buyer edits their profile.
- **Numbering:** `DIF/26-27/000001`, within GST's 16-character limit. The next number comes from `update invoice_counters … returning last` in the **same transaction** as the invoice insert, so no gaps and no duplicates even under concurrent webhooks. The financial year runs Apr–Mar, IST.
- **Trigger:** `subscription.charged` → `invoiceService.issueForPayment(...)`.
    - Idempotent on the payment id: a redelivery or retry never creates a second invoice.
    - The amount is **what Razorpay actually charged** (`payment.amount`), not recomputed.
    - The ₹5 refundable authorisation in a plan change is not a sale: it sends no `charged` event, so it gets no invoice.
- **Tax maths (integer paise):**
    - Total = amount charged.
    - Taxable = round(total ÷ 1.18); GST = total − taxable.
    - **Place of supply** = the state code in the buyer's GSTIN (first 2 digits) if they have one, else their profile state, else the seller's state (unregistered buyer with no address).
    - Same state as the seller → **CGST 9% + SGST 9%** (split the GST; any odd paisa goes to SGST). Different state → **IGST 18%**.
    - Totals in words, Indian style ("Rupees Four Thousand Five Hundred Ninety-Nine and Sixty-Four Paise only").
- **PDF (DifAi format):** an HTML template in the app's black-and-white style.
    - Header: DifAi wordmark, "TAX INVOICE", invoice no., date.
    - Seller and buyer blocks with GSTINs; place of supply.
    - Line: plan, period, SAC, taxable value; tax lines; total; amount in words.
    - Footer: Razorpay payment id, "Computer-generated invoice, no signature required", Sirah Digital contact.
    - Rendered on demand with Chromium (A4). Nothing is stored except the row; the same row always gives the same PDF.
- **API:**
    - `GET /api/billing/invoices`: the owner's invoices, newest first.
    - `GET /api/billing/invoices/:id/pdf`: owner of that firm only (403 otherwise; 404 for another firm's id).
    - Superadmin: a list in /admin/billing plus download.
- **Web:** an "Invoices" table on /app/billing (date, no., plan, amount, Download). Monochrome, same `cm-*` styles.

## Impact map
| Area | Files | Risk |
|---|---|---|
| Webhook | `billing.service.ts` (charged → issue invoice) | an invoice failure must not undo the plan change: issued after the plan update, failure logged + retried by Razorpay's redelivery (idempotent) |
| DB | migration 0106 (additive) | none to existing data |
| Env | `INVOICE_SELLER_*` | missing seller details → invoices not issued, logged loudly; payments unaffected |
| PDF | new `subscription-invoice.service.ts` (Chromium) | Chromium launch on prod (same as eCourts) |
| Types / web | `packages/types`, `useBilling.ts`, `views/BillingView.tsx`, `admin/views/BillingView.tsx` | billing page layout |
| Docs | MEMORY, TESTING, CHANGELOG | |

## Edge cases
- **Duplicate webhook / retry:** the unique payment id makes it a no-op.
- **Two webhooks at once:** the counter row lock serialises numbering.
- **Buyer GSTIN malformed:** validated (15 characters, state code 01–38, GSTIN pattern). If it's invalid, the buyer is treated as unregistered (B2C) and it's logged.
- **No seller config:** skip with an error log. The plan still activates.
- **Refund:** needs a **credit note**. Out of scope for v1: issued manually, noted in the doc.
- **Year boundary (31 Mar → 1 Apr IST):** a new counter row, numbering restarts at 000001.
- **Someone else's invoice:** 404, with no leak of whether the id exists.
- **The free plan and the ₹5 authorisation:** no invoice.

## Acceptance criteria
1. A successful charge creates exactly one invoice, even if the webhook arrives twice.
2. Invoice numbers are sequential with no gaps per financial year, under concurrent webhooks.
3. Same-state buyer → CGST + SGST; other state → IGST; buyer GSTIN state wins over the profile state; amounts add up to the charged total to the paisa.
4. The PDF shows all mandatory GST invoice fields: seller and buyer name, address and GSTIN; invoice no. and date; SAC; taxable value; tax rate and amount per tax; total; place of supply; amount in words.
5. Only the firm owner and the superadmin can list or download; other users get 403/404.
6. Missing seller config → the plan still activates; the invoice is skipped with an error log.

## Seller (from the GST certificate, 2026-11-13)
- SIRAH DIGITAL, proprietor M MOHAMED RIYAZ, GSTIN 33CVVPM9805M1ZO (letter O; checksum verified), SY NO 203/10B, Featherlite, 200 Feet Road, Zamin Pallavaram, Chennai, Tamil Nadu 600044. Set as `INVOICE_SELLER_*` env (local .env now; prod at deploy).

## Still from the owner
- Sirah Digital's **legal name**, **GSTIN**, **registered address** (with state and PIN), invoice **contact email/phone**.
- **SAC code** your CA wants: usually **998315** (hosting / IT infrastructure) or **997331** (software licence). Confirm with your CA.
- **Invoice prefix** (default `DIF`).
