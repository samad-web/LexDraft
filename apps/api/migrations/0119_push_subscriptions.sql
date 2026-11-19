-- =============================================================================
-- 0119 web-push (owner 2026-11-19): phone/browser notifications. One row per
-- device that turned notifications on. Additive and idempotent.
-- =============================================================================
create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);
