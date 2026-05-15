-- =============================================================================
-- 0024_engagement_templates.sql
-- =============================================================================
-- Firm-tier engagement-letter automation: per-firm template library keyed by
-- matter type. The orchestrator gates `engagement.letters` to the Firm plan;
-- the schema here is plan-agnostic - only the route middleware enforces tier.
--
-- A firm may keep many templates per matter type (e.g. one for retainer-based
-- engagements, one for hourly mandates) but only one of them carries the
-- `is_default` flag. The partial unique index enforces that invariant at the
-- database level so concurrent toggles can't produce two defaults for the
-- same (firm, matter_type) pair.
--
-- All grants are idempotent.
-- =============================================================================

create table if not exists engagement_templates (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references firms(id) on delete cascade,
  matter_type     text not null,
  scope_clauses   text not null,
  fee_clauses     text not null,
  retainer_inr    bigint,
  notes           text,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references users(id) on delete set null
);

-- One default per (firm, matter_type). Partial index - non-default rows
-- coexist freely.
create unique index if not exists engagement_templates_firm_matter_default_uq
  on engagement_templates (firm_id, matter_type) where is_default = true;

create index if not exists engagement_templates_firm_idx
  on engagement_templates (firm_id);

-- Keep updated_at fresh via the shared trigger function defined in 0001_init.sql.
do $$ begin
  create trigger trg_engagement_templates_updated
    before update on engagement_templates
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
