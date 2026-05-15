-- =============================================================================
-- LexDraft - Solo Advocate role + Firm-tier nav gates
-- =============================================================================
-- Two problems being fixed:
--
--   (a) Solo signups got `role = 'Solo Advocate'` (text) but no `role_id`,
--       so the resolver returned baseline-only features even on the Solo
--       plan. They couldn't see Cases, Clients, etc. in DB mode (demo mode
--       only hid this by serving an overly-permissive fallback).
--
--   (b) Three sidebar items - Firm overview, Members, Analytics - had no
--       feature key to gate on, so every plan saw them. The dashboard
--       spec (WORKFLOW_DASHBOARDS.md §3) is explicit: Solo gets none of
--       these; Practice gets Members only; Firm gets all three.
--
-- This migration:
--
--   1. Adds the missing feature keys (firm.dashboard.view, firm.members.view,
--      analytics.firm) and maps them to the right plans + roles.
--   2. Seeds a "Solo Advocate" system role and grants the same feature set
--      the Solo plan allows - so a real Solo sign-up gets a real role.
--
-- Idempotent.
-- =============================================================================

-- ---- features catalog ------------------------------------------------------

insert into features (key, name, description, domain, default_baseline) values
  ('firm.dashboard.view',  'View firm overview',  'See the firm-wide overview dashboard (KPIs, revenue, members).', 'admin', false),
  ('firm.members.view',    'View members',        'See the firm members roster.',                                   'admin', false),
  ('analytics.firm',       'View firm analytics', 'See firm-level analytics (revenue, top clients, practice mix).', 'reports', false)
on conflict (key) do nothing;

-- ---- plan_features (Layer 1) ----------------------------------------------
-- firm.dashboard.view + analytics.firm: Firm plan only (per spec §3.3).
insert into plan_features (plan_tier, feature_key, enabled)
select 'Firm'::firm_plan_tier, key, true
from features
where key in ('firm.dashboard.view','firm.members.view','analytics.firm')
on conflict do nothing;

-- firm.members.view: Practice + Firm (Practice can see chamber roster).
insert into plan_features (plan_tier, feature_key, enabled)
select 'Practice'::firm_plan_tier, 'firm.members.view', true
on conflict do nothing;

-- ---- Solo Advocate system role --------------------------------------------
-- Mirrors the 'Solo Advocate' text role auth.service.ts uses for self-serve
-- solo sign-ups. Granting it the same feature set the Solo plan permits keeps
-- the resolver's plan∩role intersection meaningful.
--
-- We use WHERE NOT EXISTS instead of ON CONFLICT here: the `roles` table only
-- has *partial* unique indexes (`roles_system_name_uq` is conditional on
-- `firm_id IS NULL AND is_system = true`), and PG can't reliably infer a
-- partial index as an ON CONFLICT arbiter from `(firm_id, name)`. WHERE NOT
-- EXISTS sidesteps the inference and is equally idempotent.
insert into roles (id, firm_id, name, description, is_system)
select gen_random_uuid(), null, 'Solo Advocate',
       'Independent practitioner on the Solo plan. Owns their own matters, clients, drafting, billing.',
       true
where not exists (
  select 1 from roles
  where firm_id is null and is_system = true and name = 'Solo Advocate'
);

-- ---- role_features (Layer 2) - Solo Advocate ------------------------------
do $$
declare
  r_solo uuid := (select id from roles where firm_id is null and is_system = true and name = 'Solo Advocate');
begin
  if r_solo is null then
    raise notice 'Solo Advocate role not found - skipping role_features seed';
    return;
  end if;

  -- Tenant CRUD + drafting basics. Matches the Solo plan list from 0009 +
  -- the extensions from 0012 (billing/leads/research).
  insert into role_features (role_id, feature_key, enabled)
  select r_solo, key, true
  from features
  where key in (
    'drafting.basic','drafting.templates','drafting.clauses',
    'review.comment',
    'matter.view','matter.create',
    'client.view','client.create',
    'leads.view','leads.create',
    'billing.view','billing.invoice','billing.expense',
    'research.basic',
    'reports.usage'
  )
  on conflict do nothing;
end $$;

-- ---- role_features (Layer 2) - Firm-tier nav gates ------------------------
-- firm.dashboard.view, firm.members.view, analytics.firm:
--   - Firm Admin gets all (mass-insert below)
--   - Partner gets all three
--   - Practice Group Lead gets members + dashboard, NOT analytics
--   - Senior Associate gets members only (read the roster, no dashboard)
do $$
declare
  r_admin   uuid := (select id from roles where firm_id is null and is_system = true and name = 'Firm Admin');
  r_partner uuid := (select id from roles where firm_id is null and is_system = true and name = 'Partner');
  r_lead    uuid := (select id from roles where firm_id is null and is_system = true and name = 'Practice Group Lead');
  r_senior  uuid := (select id from roles where firm_id is null and is_system = true and name = 'Senior Associate');
begin
  if r_partner is not null then
    insert into role_features (role_id, feature_key, enabled) values
      (r_partner, 'firm.dashboard.view', true),
      (r_partner, 'firm.members.view',   true),
      (r_partner, 'analytics.firm',      true)
    on conflict do nothing;
  end if;
  if r_lead is not null then
    insert into role_features (role_id, feature_key, enabled) values
      (r_lead, 'firm.dashboard.view', true),
      (r_lead, 'firm.members.view',   true)
    on conflict do nothing;
  end if;
  if r_senior is not null then
    insert into role_features (role_id, feature_key, enabled) values
      (r_senior, 'firm.members.view', true)
    on conflict do nothing;
  end if;
  -- Firm Admin sweep - picks up the new keys whether or not the role was
  -- already mass-inserted by 0009/0012.
  if r_admin is not null then
    insert into role_features (role_id, feature_key, enabled)
    select r_admin, f.key, true
    from features f
    where f.domain <> 'baseline'
    on conflict do nothing;
  end if;
end $$;

-- ---- backfill existing solo users -----------------------------------------
-- Any existing user whose text role is 'Solo Advocate' and who has no
-- role_id yet should be re-pointed at the new system role.
update users
set role_id = (select id from roles where firm_id is null and is_system = true and name = 'Solo Advocate')
where role = 'Solo Advocate' and role_id is null;
