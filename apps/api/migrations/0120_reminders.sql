-- =============================================================================
-- 0120_reminders.sql (build-docs/features/reminders.md, android-push.md)
-- Additive only.
--  * reminders: a reminder an advocate sets by hand ("remind me on 24 Nov at
--    7 PM"), optionally on a case. Sent once by the reminders.due job.
--  * push_subscriptions.kind: 'web' (web-push) or 'fcm' (Android app token
--    stored in `endpoint`; p256dh/auth are empty for fcm rows).
-- =============================================================================

create table if not exists reminders (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references firms(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  case_id     uuid references cases(id) on delete cascade,
  title       text not null,
  note        text not null default '',
  remind_at   timestamptz not null,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists reminders_due_idx on reminders (remind_at) where sent_at is null;
create index if not exists reminders_user_idx on reminders (user_id, remind_at);
create index if not exists reminders_case_idx on reminders (case_id) where case_id is not null;

alter table push_subscriptions add column if not exists kind text not null default 'web';
do $$ begin
  alter table push_subscriptions add constraint push_subscriptions_kind_chk check (kind in ('web', 'fcm'));
exception when duplicate_object then null; end $$;
