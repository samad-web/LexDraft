-- Razorpay replaces Dodo Payments (features/razorpay-billing.md). Additive only:
-- the Dodo columns stay (never used in live mode) and are dropped later with approval.

alter table firms add column if not exists razorpay_customer_id text;
alter table firms add column if not exists razorpay_subscription_id text;
create index if not exists firms_razorpay_subscription_idx on firms (razorpay_subscription_id)
  where razorpay_subscription_id is not null;

alter table billing_events alter column provider set default 'razorpay';

-- Razorpay plans can't be edited, so each (plan, cycle, advocates, amount) gets
-- its own Razorpay plan, created the first time someone buys it. The webhook maps
-- a subscription's plan_id back to what was bought, so seats come from Razorpay.
create table if not exists razorpay_plans (
  razorpay_plan_id text primary key,
  plan             text not null check (plan in ('solo', 'practice')),
  cycle            text not null check (cycle in ('monthly', 'annual')),
  seats            integer not null check (seats between 1 and 50),
  amount_paise     integer not null check (amount_paise > 0),
  created_at       timestamptz not null default now(),
  unique (plan, cycle, seats, amount_paise)
);
