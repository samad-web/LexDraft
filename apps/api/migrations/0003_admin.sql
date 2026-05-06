-- =============================================================================
-- LexDraft — platform admin schema
-- =============================================================================
-- Adds the tables and columns the /admin tree depends on:
--   * firm plan / billing fields on firms
--   * suspension status on firms & users
--   * feature_flags (per-firm module toggles)
--   * firm_branding (per-firm display name, logo, accent)
--   * audit_log (every superadmin mutation)
--   * document_templates (platform-wide & firm-scoped)
-- All idempotent.
-- =============================================================================

-- ---- enums ------------------------------------------------------------------
do $$ begin
  create type firm_plan_tier as enum ('Solo', 'Practice', 'Firm');
exception when duplicate_object then null; end $$;

do $$ begin
  create type billing_status as enum ('trial', 'active', 'past_due', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type firm_status as enum ('active', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_status as enum ('active', 'suspended', 'deactivated');
exception when duplicate_object then null; end $$;

do $$ begin
  create type template_scope as enum ('platform', 'firm');
exception when duplicate_object then null; end $$;

-- ---- firms: plan + billing + suspension ------------------------------------
alter table firms add column if not exists plan_tier      firm_plan_tier not null default 'Practice';
alter table firms add column if not exists plan_status    billing_status not null default 'active';
alter table firms add column if not exists mrr_inr        integer        not null default 0;
alter table firms add column if not exists renews_at      date;
alter table firms add column if not exists status         firm_status    not null default 'active';
alter table firms add column if not exists suspended_at   timestamptz;

-- ---- users: suspension -----------------------------------------------------
alter table users add column if not exists status         user_status    not null default 'active';
alter table users add column if not exists suspended_at   timestamptz;
alter table users add column if not exists last_seen_at   timestamptz;

-- ---- feature_flags ---------------------------------------------------------
create table if not exists feature_flags (
  firm_id    uuid not null references firms(id) on delete cascade,
  module     text not null,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (firm_id, module)
);
create index if not exists feature_flags_firm_idx on feature_flags (firm_id);

-- ---- firm_branding ---------------------------------------------------------
create table if not exists firm_branding (
  firm_id       uuid primary key references firms(id) on delete cascade,
  display_name  text not null,
  logo_url      text,
  accent_color  text,
  updated_at    timestamptz not null default now()
);

-- ---- audit_log -------------------------------------------------------------
create table if not exists audit_log (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid,
  actor_email    text not null,
  action         text not null,
  target_type    text not null,           -- 'firm' | 'user' | 'template' | 'platform'
  target_id      uuid,
  payload        jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists audit_log_created_idx on audit_log (created_at desc);
create index if not exists audit_log_actor_idx   on audit_log (actor_user_id);
create index if not exists audit_log_target_idx  on audit_log (target_type, target_id);

-- ---- document_templates ----------------------------------------------------
create table if not exists document_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null,
  scope       template_scope not null,
  firm_id     uuid references firms(id) on delete cascade,
  body        text not null,
  updated_at  timestamptz not null default now(),
  -- A slug is unique within its scope: platform-wide templates compete with
  -- each other only; firm-scoped templates compete only within that firm.
  constraint templates_scope_firm_chk check (
    (scope = 'platform' and firm_id is null) or
    (scope = 'firm'     and firm_id is not null)
  )
);
create unique index if not exists templates_platform_slug_idx
  on document_templates (slug) where scope = 'platform';
create unique index if not exists templates_firm_slug_idx
  on document_templates (firm_id, slug) where scope = 'firm';

-- ---- updated_at triggers ---------------------------------------------------
do $$ begin
  create trigger trg_feature_flags_updated  before update on feature_flags  for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_firm_branding_updated  before update on firm_branding  for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_templates_updated      before update on document_templates for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- seed: defaults for the bootstrap firm ---------------------------------
-- Branding row mirrors the firm name unless overridden.
insert into firm_branding (firm_id, display_name)
  select id, name from firms where id = '00000000-0000-0000-0000-000000000001'
  on conflict (firm_id) do nothing;

-- All modules on by default for the seed firm.
insert into feature_flags (firm_id, module, enabled) values
  ('00000000-0000-0000-0000-000000000001', 'drafting',       true),
  ('00000000-0000-0000-0000-000000000001', 'cases',          true),
  ('00000000-0000-0000-0000-000000000001', 'contracts',      true),
  ('00000000-0000-0000-0000-000000000001', 'billing',        true),
  ('00000000-0000-0000-0000-000000000001', 'research',       true),
  ('00000000-0000-0000-0000-000000000001', 'limitation',     true),
  ('00000000-0000-0000-0000-000000000001', 'ecourts',        true),
  ('00000000-0000-0000-0000-000000000001', 'analytics',      true),
  ('00000000-0000-0000-0000-000000000001', 'firm_dashboard', true)
  on conflict do nothing;

-- A trio of seed platform templates so the templates view has content.
insert into document_templates (id, name, slug, scope, body) values
  ('11111111-1111-1111-1111-000000000001', 'Plaint — Civil Suit',          'plaint-civil',     'platform', '# Plaint\n\nIN THE COURT OF ...'),
  ('11111111-1111-1111-1111-000000000002', 'Vakalatnama',                  'vakalatnama',      'platform', '# Vakalatnama\n\nI/We the undersigned ...'),
  ('11111111-1111-1111-1111-000000000003', 'Bail Application — Sec. 437',  'bail-app-437',     'platform', '# Bail Application u/s 437 CrPC\n\n...')
  on conflict do nothing;
