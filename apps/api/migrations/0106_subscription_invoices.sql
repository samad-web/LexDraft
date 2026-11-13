-- GST tax invoices for DifAi subscriptions (features/gst-invoices.md). Additive.
-- Sirah Digital is the seller (Razorpay is only the gateway), so every
-- successful subscription charge gets one invoice, numbered without gaps per
-- financial year.

create table if not exists invoice_counters (
  fy   text primary key,               -- '26-27'
  last integer not null default 0 check (last >= 0)
);

create table if not exists subscription_invoices (
  id                       uuid primary key default gen_random_uuid(),
  invoice_no               text not null unique,     -- DIF/26-27/000001 (<= 16 chars)
  fy                       text not null,
  seq                      integer not null,
  firm_id                  uuid not null references firms(id) on delete restrict,
  razorpay_payment_id      text not null unique,     -- one invoice per charge
  razorpay_subscription_id text,
  plan                     text not null,
  cycle                    text not null,
  seats                    integer not null,
  period_start             timestamptz,
  period_end               timestamptz,
  -- Snapshots: an issued invoice never changes when profiles change.
  buyer                    jsonb not null,
  seller                   jsonb not null,
  place_of_supply          text not null,            -- '33-Tamil Nadu'
  sac                      text not null,
  taxable_paise            integer not null check (taxable_paise >= 0),
  cgst_paise               integer not null default 0 check (cgst_paise >= 0),
  sgst_paise               integer not null default 0 check (sgst_paise >= 0),
  igst_paise               integer not null default 0 check (igst_paise >= 0),
  total_paise              integer not null check (total_paise > 0),
  issued_at                timestamptz not null default now(),
  unique (fy, seq),
  check (taxable_paise + cgst_paise + sgst_paise + igst_paise = total_paise)
);

create index if not exists subscription_invoices_firm_idx on subscription_invoices (firm_id, issued_at desc);
