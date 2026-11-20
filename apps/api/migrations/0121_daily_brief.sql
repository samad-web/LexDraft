-- Daily brief on/off per user (build-docs/features/daily-brief.md). Additive.
alter table users add column if not exists daily_brief boolean not null default true;
