-- Superadmin console v2 (build-docs/PLAN.md, 2026-11-17). Additive only: new
-- table + nullable / defaulted columns; no existing row changes meaning.

-- 1. Platform-wide admin settings (AI budget, alert thresholds, AI pause).
create table if not exists platform_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users(id) on delete set null
);

-- 2. Pause AI for one firm (admin-ai-spend-guard).
alter table firms add column if not exists ai_paused boolean not null default false;

-- 3. Name printed for a custom (Enterprise) plan (admin-custom-plan).
alter table firms add column if not exists custom_plan_name text;

-- 4. Monthly AI credit cap on one user, set by DifAi (admin-per-user-usage).
--    null = no cap. Half-credit steps like the rest of the ledger.
alter table users add column if not exists credit_cap_month numeric(9,1)
  check (credit_cap_month is null or credit_cap_month >= 0);
