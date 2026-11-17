-- "Plan active" + renewal reminders on WhatsApp (features/app-handoff-and-renewal-reminders.md).
-- Additive only.

-- 1. Per plan payment (one invoice = one payment): when the "plan active"
--    message went out, or why not. Set before sending (claim), cleared on failure.
alter table subscription_invoices add column if not exists plan_active_wa_sent_at timestamptz;
alter table subscription_invoices add column if not exists plan_active_wa_error text;

-- 2. One row per reminder sent: firm + paid period (its renews_at) + kind.
--    A renewal moves renews_at, so a new period gets new keys.
create table if not exists plan_renewal_reminders (
  firm_id     uuid not null references firms(id) on delete cascade,
  period_end  timestamptz not null,
  kind        text not null check (kind in ('d7', 'd1', 'd0')),
  sent_to     text,
  sent_at     timestamptz not null default now(),
  primary key (firm_id, period_end, kind)
);
