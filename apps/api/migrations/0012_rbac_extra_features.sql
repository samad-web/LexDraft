-- =============================================================================
-- LexDraft - RBAC catalog extensions for tenant CRUD
-- =============================================================================
-- 0009_rbac.sql seeded the matter/client/drafting/admin/reports feature keys
-- but tenant CRUD for invoicing, expenses, leads, and research had no catalog
-- entries - so the routes couldn't be gated by `requireFeature`. This
-- migration:
--
--   1. Adds the missing keys (billing.*, leads.*, research.basic).
--   2. Maps them to plan tiers (Layer 1).
--   3. Maps them to seeded system roles (Layer 2) by mirroring closely-related
--      grants - anyone who already has `client.*` gets `leads.*`, anyone with
--      `drafting.basic` gets `research.basic`, anyone with `reports.billing`
--      gets `billing.*`.
--
-- Note: hearings, limitations, diary, tasks, archive, analytics intentionally
-- DO NOT get dedicated keys - they're satisfied by `matter.view/create` and
-- `reports.activity` already in the catalog. The route layer gates them on
-- those existing keys.
--
-- All idempotent.
-- =============================================================================

-- ---- features catalog ------------------------------------------------------

insert into features (key, name, description, domain, default_baseline) values
  ('billing.view',     'View invoices & expenses',  'Read the firm''s invoice/expense ledger.',     'billing',  false),
  ('billing.invoice',  'Create invoices',           'Issue invoices on behalf of the firm.',        'billing',  false),
  ('billing.expense',  'Record expenses',           'Add expense entries against a matter.',        'billing',  false),
  ('leads.view',       'View leads',                'See the firm''s pipeline of prospective clients.', 'client', false),
  ('leads.create',     'Manage leads',              'Add and edit leads in the pipeline.',          'client',  false),
  ('research.basic',   'Use legal research',        'Run searches against the legal-research module.', 'drafting', false)
on conflict (key) do nothing;

-- ---- plan_features (Layer 1) ----------------------------------------------
-- Solo: invoicing/leads/research are core revenue tools; analytics already
-- enabled at Practice via reports.activity.
insert into plan_features (plan_tier, feature_key, enabled)
select 'Solo'::firm_plan_tier, key, true
from features
where key in ('billing.view','billing.invoice','billing.expense','leads.view','leads.create','research.basic')
on conflict do nothing;

insert into plan_features (plan_tier, feature_key, enabled)
select 'Practice'::firm_plan_tier, key, true
from features
where key in ('billing.view','billing.invoice','billing.expense','leads.view','leads.create','research.basic')
on conflict do nothing;

-- Firm: catch-up to "every non-baseline feature" rule from 0009.
insert into plan_features (plan_tier, feature_key, enabled)
select 'Firm'::firm_plan_tier, key, true
from features
where domain <> 'baseline'
on conflict do nothing;

-- ---- role_features (Layer 2) ----------------------------------------------
-- Mirror existing grants so the new keys land on roles that already have the
-- analogous responsibilities. We never grant beyond the original spec.

-- billing.* follows reports.billing.
insert into role_features (role_id, feature_key, enabled)
select rf.role_id, k, true
from role_features rf
cross join unnest(array['billing.view','billing.invoice','billing.expense']::text[]) as k
where rf.feature_key = 'reports.billing' and rf.enabled = true
on conflict do nothing;

-- leads.view follows client.view.
insert into role_features (role_id, feature_key, enabled)
select rf.role_id, 'leads.view', true
from role_features rf
where rf.feature_key = 'client.view' and rf.enabled = true
on conflict do nothing;

-- leads.create follows client.create.
insert into role_features (role_id, feature_key, enabled)
select rf.role_id, 'leads.create', true
from role_features rf
where rf.feature_key = 'client.create' and rf.enabled = true
on conflict do nothing;

-- research.basic follows drafting.basic.
insert into role_features (role_id, feature_key, enabled)
select rf.role_id, 'research.basic', true
from role_features rf
where rf.feature_key = 'drafting.basic' and rf.enabled = true
on conflict do nothing;

-- Firm Admin sweeps up any non-baseline keys (re-run from 0009 to catch new ones).
insert into role_features (role_id, feature_key, enabled)
select r.id, f.key, true
from roles r, features f
where r.firm_id is null and r.is_system = true and r.name = 'Firm Admin'
  and f.domain <> 'baseline'
on conflict do nothing;
