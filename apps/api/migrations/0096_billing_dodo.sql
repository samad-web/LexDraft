-- 0096: self-serve billing through Dodo Payments.
--
-- firms gets the plan the user picked at sign-up, the billing cycle, and the
-- Dodo customer / subscription ids. billing_events is an append-only log of
-- everything plan-related (plan picked at sign-up, checkout started, paid,
-- renewed, failed, cancelled) that the superadmin Billing page reads to spot
-- who to follow up with. Additive only.

alter table firms add column if not exists selected_plan text
  check (selected_plan in ('free', 'solo', 'practice', 'firm'));
alter table firms add column if not exists billing_cycle text
  check (billing_cycle in ('monthly', 'annual'));
alter table firms add column if not exists dodo_customer_id text;
alter table firms add column if not exists dodo_subscription_id text;

create index if not exists firms_dodo_subscription_idx on firms (dodo_subscription_id)
  where dodo_subscription_id is not null;

create table if not exists billing_events (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references firms(id) on delete cascade,
  user_id      uuid references users(id) on delete set null,
  kind         text not null check (kind in (
                 'signup', 'checkout_started', 'subscription_active', 'renewed',
                 'plan_changed', 'payment_failed', 'on_hold', 'cancelled', 'expired')),
  plan         text,
  cycle        text,
  amount_inr   integer,
  provider     text not null default 'dodo',
  provider_ref text,
  -- Standard Webhooks id: a redelivered webhook is ignored.
  webhook_id   text unique,
  created_at   timestamptz not null default now()
);

create index if not exists billing_events_created_idx on billing_events (created_at desc);
create index if not exists billing_events_firm_idx on billing_events (firm_id, created_at desc);
