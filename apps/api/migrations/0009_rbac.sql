-- =============================================================================
-- LexDraft - Firm-tier RBAC, Practice Groups, Feature Entitlements
-- =============================================================================
-- Implements Phase 1 of lexdraft-user-management-spec.md:
--   * practice_groups          (sub-units inside a firm)
--   * roles                    (system + per-firm custom; seeded with 8 system roles)
--   * features                 (catalog from spec §6, seeded)
--   * plan_features            (Layer 1: which features each plan includes)
--   * role_features            (Layer 2: which features each role grants by default)
--   * user_feature_overrides   (Layer 3: per-user grant/deny; table-only this phase)
--   * users.role_id            (FK to roles; coexists with the legacy text column)
--   * users.practice_group_id  (FK to practice_groups)
-- All idempotent.
-- =============================================================================

-- ---- enums ------------------------------------------------------------------
do $$ begin
  create type firm_type as enum ('firm', 'practice_group');
exception when duplicate_object then null; end $$;

do $$ begin
  create type override_decision as enum ('grant', 'deny');
exception when duplicate_object then null; end $$;

-- Add a 'type' column on firms so a firm row can flag itself as a standalone
-- practice-group tenant (per spec §2). Defaults to 'firm' for existing rows.
alter table firms add column if not exists type firm_type not null default 'firm';

-- ---- practice_groups --------------------------------------------------------
create table if not exists practice_groups (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references firms(id) on delete cascade,
  name          text not null,
  lead_user_id  uuid references users(id) on delete set null,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists practice_groups_firm_idx on practice_groups (firm_id);
create unique index if not exists practice_groups_firm_name_uq
  on practice_groups (firm_id, lower(name)) where archived_at is null;

do $$ begin
  create trigger trg_practice_groups_updated
    before update on practice_groups
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- roles ------------------------------------------------------------------
-- firm_id IS NULL for system roles (the 8 from spec §4.1). For a custom role
-- created by a firm admin, firm_id points at that firm. base_role_id lets a
-- custom role inherit from a system role (Phase 2 wires the inheritance UI).
create table if not exists roles (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid references firms(id) on delete cascade,
  name          text not null,
  description   text,
  is_system     boolean not null default false,
  base_role_id  uuid references roles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists roles_system_name_uq
  on roles (name) where firm_id is null and is_system = true;
create unique index if not exists roles_firm_name_uq
  on roles (firm_id, lower(name)) where firm_id is not null;

do $$ begin
  create trigger trg_roles_updated
    before update on roles
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- features (catalog) ----------------------------------------------------
-- Static-ish reference table: rows added/removed only by deploys, not by users.
create table if not exists features (
  key                 text primary key,
  name                text not null,
  description         text,
  domain              text not null,        -- e.g. 'drafting', 'esign', 'admin'
  default_baseline    boolean not null default false   -- spec §5.1 baseline
);

-- ---- plan_features (Layer 1) -----------------------------------------------
create table if not exists plan_features (
  plan_tier    firm_plan_tier not null,
  feature_key  text not null references features(key) on delete cascade,
  enabled      boolean not null default true,
  primary key (plan_tier, feature_key)
);
create index if not exists plan_features_tier_idx on plan_features (plan_tier);

-- ---- role_features (Layer 2) -----------------------------------------------
create table if not exists role_features (
  role_id      uuid not null references roles(id) on delete cascade,
  feature_key  text not null references features(key) on delete cascade,
  enabled      boolean not null default true,
  primary key (role_id, feature_key)
);
create index if not exists role_features_role_idx on role_features (role_id);

-- ---- user_feature_overrides (Layer 3) --------------------------------------
create table if not exists user_feature_overrides (
  user_id      uuid not null references users(id) on delete cascade,
  feature_key  text not null references features(key) on delete cascade,
  decision     override_decision not null,
  granted_by   uuid references users(id) on delete set null,
  granted_at   timestamptz not null default now(),
  reason       text,
  primary key (user_id, feature_key)
);

-- ---- users: role_id + practice_group_id ------------------------------------
alter table users add column if not exists role_id           uuid references roles(id) on delete set null;
alter table users add column if not exists practice_group_id uuid references practice_groups(id) on delete set null;
create index if not exists users_role_idx on users (role_id);
create index if not exists users_pg_idx   on users (practice_group_id);

-- =============================================================================
-- SEED - system roles, feature catalog, plan & role mappings
-- =============================================================================

-- ---- 8 system roles (spec §4.1) ---------------------------------------------
insert into roles (id, firm_id, name, description, is_system) values
  (gen_random_uuid(), null, 'Firm Admin',           'Full access to all firm features + User Management + Billing', true),
  (gen_random_uuid(), null, 'Practice Group Lead',  'All drafting features + manage users within their practice group', true),
  (gen_random_uuid(), null, 'Partner',              'Full drafting, review, e-sign, matter management, billing view', true),
  (gen_random_uuid(), null, 'Senior Associate',     'Drafting, AI drafting, clause library, review, e-sign', true),
  (gen_random_uuid(), null, 'Associate',            'Drafting, AI drafting, clause library', true),
  (gen_random_uuid(), null, 'Paralegal',            'Drafting (limited), templates, document assembly', true),
  (gen_random_uuid(), null, 'Legal Secretary',      'Document formatting, calendar, basic templates', true),
  (gen_random_uuid(), null, 'Intern',               'Read-only or restricted drafting', true)
on conflict do nothing;

-- ---- feature catalog (spec §6) ----------------------------------------------
insert into features (key, name, description, domain, default_baseline) values
  -- Baseline (every active user, regardless of role/plan - spec §5.1)
  ('profile.view',         'View own profile',                 'Read your profile and update your password.', 'baseline', true),
  ('profile.update',       'Update own profile',               'Edit your profile and change your password.', 'baseline', true),
  ('announcements.view',   'View firm announcements',          'See announcements posted by firm admins.',   'baseline', true),
  ('shared.documents',     'View shared documents',            'Access documents explicitly shared with you.', 'baseline', true),
  ('search.workspace',     'Search workspace',                 'Search within your accessible workspace.',     'baseline', true),

  -- Drafting & Documents
  ('drafting.basic',       'Create/edit documents',            'Author and edit documents in the firm workspace.', 'drafting', false),
  ('drafting.ai',          'AI-assisted drafting',             'Use Lex.AI to generate drafts.',                   'drafting', false),
  ('drafting.templates',   'Use template library',             'Use the platform and firm template libraries.',    'drafting', false),
  ('drafting.clauses',     'Clause library access',            'Browse and insert clauses from the firm library.', 'drafting', false),
  ('drafting.compare',     'Document comparison',              'Compare versions and produce redlines.',           'drafting', false),

  -- Review & Approval
  ('review.comment',       'Comment on documents',             'Leave comments on shared documents.',              'review',   false),
  ('review.approve',       'Approve/reject documents',         'Approve or reject documents in review.',           'review',   false),
  ('review.track_changes', 'Manage tracked changes',           'Accept and reject tracked changes.',               'review',   false),

  -- Signing & Delivery
  ('esign.send',           'Send for e-signature',             'Initiate an e-sign envelope.',                     'esign',    false),
  ('esign.bulk',           'Bulk signature workflows',         'Send envelopes in bulk.',                          'esign',    false),

  -- Matter & Client Management
  ('matter.view',          'View matters',                     'See matters in the firm.',                         'matter',   false),
  ('matter.create',        'Create matters',                   'Open new matters for clients.',                    'matter',   false),
  ('matter.assign',        'Assign matters',                   'Assign matters to advocates.',                     'matter',   false),
  ('client.view',          'View clients',                     'See client records.',                              'client',   false),
  ('client.create',        'Create clients',                   'Onboard new clients.',                             'client',   false),

  -- Administration
  ('admin.users',          'User management',                  'Open the User Management section.',                'admin',    false),
  ('admin.roles',          'Role editor',                      'Create and edit roles.',                           'admin',    false),
  ('admin.billing',        'Billing & subscription',           'Manage the firm subscription and billing details.','admin',    false),
  ('admin.audit',          'Audit logs',                       'View the audit log.',                              'admin',    false),
  ('admin.practice_groups','Practice groups',                  'Create and manage practice groups.',               'admin',    false),

  -- Reporting
  ('reports.usage',        'Usage reports',                    'View AI/feature usage reports.',                   'reports',  false),
  ('reports.billing',      'Billing reports',                  'View billing reports.',                            'reports',  false),
  ('reports.activity',     'Activity reports',                 'View activity reports.',                           'reports',  false)
on conflict (key) do nothing;

-- ---- plan_features mapping (Layer 1) ---------------------------------------
-- Mirrors PRICING_AND_TIERS.md §3.2:
--   Solo:     drafting + matter/client + reports.usage  (no admin.* beyond own-user, no AI bulk)
--   Practice: + AI, e-sign, review, admin.users / admin.audit / admin.practice_groups
--   Firm:     EVERYTHING
-- A feature missing from a plan row is treated as disabled by the resolver.
insert into plan_features (plan_tier, feature_key, enabled)
select 'Solo'::firm_plan_tier, key, true
from features
where key in (
  'drafting.basic','drafting.templates','drafting.clauses',
  'matter.view','matter.create','client.view','client.create',
  'review.comment',
  'reports.usage'
)
on conflict do nothing;

insert into plan_features (plan_tier, feature_key, enabled)
select 'Practice'::firm_plan_tier, key, true
from features
where key in (
  'drafting.basic','drafting.ai','drafting.templates','drafting.clauses','drafting.compare',
  'review.comment','review.approve','review.track_changes',
  'esign.send',
  'matter.view','matter.create','matter.assign','client.view','client.create',
  'admin.users','admin.roles','admin.audit','admin.practice_groups',
  'reports.usage','reports.activity'
)
on conflict do nothing;

insert into plan_features (plan_tier, feature_key, enabled)
select 'Firm'::firm_plan_tier, key, true
from features
where domain <> 'baseline'
on conflict do nothing;

-- ---- role_features mapping (Layer 2) ---------------------------------------
-- Default permissions per spec §4.1.
-- Helper temp view: get a system role id by name.
do $$
declare
  r_admin     uuid := (select id from roles where firm_id is null and name = 'Firm Admin');
  r_lead      uuid := (select id from roles where firm_id is null and name = 'Practice Group Lead');
  r_partner   uuid := (select id from roles where firm_id is null and name = 'Partner');
  r_senior    uuid := (select id from roles where firm_id is null and name = 'Senior Associate');
  r_assoc     uuid := (select id from roles where firm_id is null and name = 'Associate');
  r_paral     uuid := (select id from roles where firm_id is null and name = 'Paralegal');
  r_secretary uuid := (select id from roles where firm_id is null and name = 'Legal Secretary');
  r_intern    uuid := (select id from roles where firm_id is null and name = 'Intern');
begin
  -- Firm Admin: every non-baseline feature
  insert into role_features (role_id, feature_key, enabled)
  select r_admin, key, true from features where domain <> 'baseline'
  on conflict do nothing;

  -- Practice Group Lead: drafting/review/esign/matter + admin.practice_groups
  insert into role_features (role_id, feature_key, enabled)
  select r_lead, key, true
  from features
  where key in (
    'drafting.basic','drafting.ai','drafting.templates','drafting.clauses','drafting.compare',
    'review.comment','review.approve','review.track_changes',
    'esign.send',
    'matter.view','matter.create','matter.assign','client.view','client.create',
    'admin.practice_groups',
    'reports.usage','reports.activity'
  )
  on conflict do nothing;

  -- Partner: drafting/review/esign/matter + reports
  insert into role_features (role_id, feature_key, enabled)
  select r_partner, key, true
  from features
  where key in (
    'drafting.basic','drafting.ai','drafting.templates','drafting.clauses','drafting.compare',
    'review.comment','review.approve','review.track_changes',
    'esign.send',
    'matter.view','matter.create','matter.assign','client.view','client.create',
    'reports.billing','reports.activity'
  )
  on conflict do nothing;

  -- Senior Associate: drafting + ai + clauses + review + e-sign
  insert into role_features (role_id, feature_key, enabled)
  select r_senior, key, true
  from features
  where key in (
    'drafting.basic','drafting.ai','drafting.templates','drafting.clauses','drafting.compare',
    'review.comment','review.approve','review.track_changes',
    'esign.send',
    'matter.view','client.view'
  )
  on conflict do nothing;

  -- Associate: drafting + ai + clauses
  insert into role_features (role_id, feature_key, enabled)
  select r_assoc, key, true
  from features
  where key in (
    'drafting.basic','drafting.ai','drafting.templates','drafting.clauses',
    'review.comment',
    'matter.view','client.view'
  )
  on conflict do nothing;

  -- Paralegal: limited drafting + templates + document assembly
  insert into role_features (role_id, feature_key, enabled)
  select r_paral, key, true
  from features
  where key in (
    'drafting.basic','drafting.templates','drafting.clauses',
    'matter.view','client.view'
  )
  on conflict do nothing;

  -- Legal Secretary: formatting + templates + calendar (matter.view for calendar context)
  insert into role_features (role_id, feature_key, enabled)
  select r_secretary, key, true
  from features
  where key in (
    'drafting.basic','drafting.templates',
    'matter.view','client.view'
  )
  on conflict do nothing;

  -- Intern: read-only-ish - only the very basic drafting + matter view
  insert into role_features (role_id, feature_key, enabled)
  select r_intern, key, true
  from features
  where key in ('drafting.basic','matter.view','client.view')
  on conflict do nothing;
end $$;

-- ---- backfill: any user with no role_id gets the matching system role ------
-- Maps the legacy `users.role` text to a system role id where possible. Users
-- whose freeform role doesn't map are left alone (handled in code).
update users u
set role_id = r.id
from roles r
where r.firm_id is null
  and r.is_system = true
  and u.role_id is null
  and (
       (u.role = 'Solo Advocate'    and r.name = 'Partner')
    or (u.role = 'Practice Lead'    and r.name = 'Practice Group Lead')
    or (u.role = 'Managing Partner' and r.name = 'Firm Admin')
    or (u.is_superadmin             and r.name = 'Firm Admin')
  );
