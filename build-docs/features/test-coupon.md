# Feature: Owner's ₹1 test code

Status: **built 2026-11-14** (owner: "for our testing purpose alone have a coupon code for 1 rupee"; chose "code + only my accounts").

## What
- On Plan & Billing, an optional **Code** field.
- The owner's code makes any plan or Brief Pack cost **₹1**, but **only** for account emails on a server list. For anyone else the same code is "not valid", so a leaked code is useless.
- The ₹1 payment runs the real flow: Razorpay order, signed webhook, plan or credits applied, a real ₹1 GST invoice (₹1 is real money). MRR records 0 and the billing event records ₹1, so reports stay honest.

## How
- **Server env:** `BILLING_TEST_COUPON` (the code, case-insensitive) and `BILLING_TEST_EMAILS` (comma list). Either blank = off.
- **Checkout:** a valid code puts `coupon: 'test'` on **our own** Razorpay order and sets the amount to 100 paise. The webhook trusts that note because only our server creates orders. A ₹1 payment on a normal order is still refused by the amount check.
- **No migration.**

## Risks
- Someone on the list could buy anything for ₹1. That's intended, so keep the list to the owner's own test accounts.
- ₹1 invoices use real invoice numbers. Fine for real ₹1 sales; tell the CA they are tests.
