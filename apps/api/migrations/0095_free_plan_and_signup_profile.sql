-- =============================================================================
-- 0095_free_plan_and_signup_profile.sql
-- =============================================================================
-- Launch pricing: solo advocates and law students use LexDraft free until
-- 1 June 2027; law firms get a 14-day trial of everything.
--
--   firms.free_plan        A free-launch account. Stays on the Solo plan tier
--                          (so every Solo-shaped screen keeps working) with
--                          plan_status 'trial' and trial_ends_at = the end of
--                          the free period. On top of that:
--                            - AI drafting has no monthly cap
--                            - stored files are capped at 1 GB
--                            - the features behind free_plan_switches are
--                              withheld unless the superadmin switches them on
--
--   free_plan_switches     Platform-wide on/off switches, edited from the
--                          superadmin console. Each switch maps to a set of
--                          feature keys in permissions.service.ts
--                          (FREE_PLAN_SWITCH_FEATURES). Seeded off.
--
--   limitation.use         New baseline feature keys so the limitation tracker
--   co_counsel.handover    and outgoing co-counsel handovers can be withheld
--                          on their own (they were gated on matter.view).
--                          Baseline = every existing user keeps them.
--
--   users.account_type     Sign-up profile: who the user is, plus the extra
--   users.city / state     details the sign-up form now collects. All
--   users.college ...      optional; null on accounts made before this.
--
-- Backfill: self-serve Solo trials created before this migration move onto
-- the free plan (their 14-day clock is replaced by the free-period end).
-- Nothing is deleted. Idempotent.
-- =============================================================================

alter table firms
  add column if not exists free_plan boolean not null default false;

alter table users
  add column if not exists account_type text
    check (account_type in ('advocate', 'student', 'firm')),
  add column if not exists city         text,
  add column if not exists state        text,
  add column if not exists college      text,
  add column if not exists study_year   text,
  add column if not exists team_size    text;

create table if not exists free_plan_switches (
  switch_key  text primary key
    check (switch_key in ('team_chat', 'analytics', 'limitation', 'co_counsel')),
  enabled     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users(id) on delete set null
);

insert into free_plan_switches (switch_key, enabled) values
  ('team_chat', false),
  ('analytics', false),
  ('limitation', false),
  ('co_counsel', false)
on conflict (switch_key) do nothing;

insert into features (key, name, description, domain, default_baseline) values
  ('limitation.use', 'Limitation tracker',
   'Track limitation periods and use the limitation calculator.',
   'baseline', true),
  ('co_counsel.handover', 'Send co-counsel handovers',
   'Hand a matter over to an advocate outside the firm.',
   'baseline', true)
on conflict (key) do nothing;

update firms
set free_plan = true,
    trial_ends_at = timestamptz '2027-06-01 23:59:59+05:30'
where plan_tier = 'Solo'
  and plan_status = 'trial'
  and is_demo = false
  and free_plan = false;
