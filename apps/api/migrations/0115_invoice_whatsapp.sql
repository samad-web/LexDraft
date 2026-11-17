-- Send the GST invoice on WhatsApp after payment (features/invoice-whatsapp.md).
-- Additive only.

-- 1. Per invoice: when it went out on WhatsApp, to which number, or why not.
alter table subscription_invoices add column if not exists whatsapp_sent_at timestamptz;
alter table subscription_invoices add column if not exists whatsapp_to text;
alter table subscription_invoices add column if not exists whatsapp_error text;

-- 2. Unguessable, expiring links to one invoice PDF (only sha256 of the token
--    is stored, like share links).
create table if not exists invoice_links (
  token_hash  text primary key,
  invoice_id  uuid not null references subscription_invoices(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists invoice_links_expires_idx on invoice_links (expires_at);
