-- 0043_tenant_invariants.sql
--
-- Consolidated schema hardening pass. Each block is idempotent (uses
-- `if not exists`, `do $$ … exception when … then null; end $$` guards) so
-- re-running the migration on a partially-applied database is safe.
--
-- This migration addresses items from the application audit:
--
-- (1) hearings has no firm_id column → cross-tenant exposure if any service
--     forgets the case_id join. Backfill from cases, then enforce NOT NULL.
-- (2) cases.cnr is globally UNIQUE → leaks tenant existence (court-issued
--     CNRs are public identifiers; cross-firm collision is real). Switch to
--     UNIQUE (firm_id, cnr).
-- (3) Multiple tenant tables have firm_id nullable → orphan rows can slip
--     past every `where firm_id = $1` filter. Backfill from related rows
--     where possible, then enforce NOT NULL.
-- (4) Money columns stored as int4 → overflow at ~₹21.4 lakhs. Promote to
--     bigint to match the analytics views that already cast.
-- (5) File-size columns stored as int4 → overflow at 2 GB. Promote to bigint.
-- (6) Missing indexes flagged by the audit.

-- =============================================================================
-- (1) hearings.firm_id
-- =============================================================================

alter table hearings
  add column if not exists firm_id uuid;

-- Backfill from cases via the existing case_id FK. Rows where case_id is
-- already null are unsalvageable — leave them with firm_id null and they
-- will block the subsequent NOT NULL constraint; if that fires, operators
-- should resolve manually (delete orphans, or assign to a sentinel firm).
update hearings h
   set firm_id = c.firm_id
  from cases c
 where h.case_id = c.id
   and h.firm_id is null;

-- Add the FK + NOT NULL only after backfill succeeded. The validate is
-- separate so a partially-backfilled DB doesn't fail-hard mid-migration.
do $$
begin
  alter table hearings
    add constraint hearings_firm_fk
    foreign key (firm_id) references firms(id) on delete cascade
    not valid;
exception when duplicate_object then null;
end $$;

alter table hearings validate constraint hearings_firm_fk;

-- Only enforce NOT NULL if every row has been successfully backfilled.
-- Operators with legacy orphans see a clear error pointing at the gap.
do $$
declare orphan_count int;
begin
  select count(*) into orphan_count from hearings where firm_id is null;
  if orphan_count > 0 then
    raise notice
      'hearings.firm_id has % null rows after backfill — fix orphans then re-run NOT NULL manually',
      orphan_count;
  else
    alter table hearings alter column firm_id set not null;
  end if;
end $$;

create index if not exists hearings_firm_date_idx on hearings (firm_id, hearing_date);

-- =============================================================================
-- (2) cases.cnr → UNIQUE (firm_id, cnr)
-- =============================================================================

-- Drop the global unique constraint if it exists. Both possible names
-- (Postgres auto-named vs hand-named) are tried.
do $$
begin
  alter table cases drop constraint cases_cnr_key;
exception when undefined_object then null;
end $$;
do $$
begin
  alter table cases drop constraint cases_cnr_unique;
exception when undefined_object then null;
end $$;

create unique index if not exists cases_firm_cnr_uq on cases (firm_id, cnr);

-- =============================================================================
-- (3) firm_id NOT NULL on tenant tables
-- =============================================================================

-- Generic enforcer: for each (table, column) pair, set NOT NULL only when
-- no null rows remain. We don't backfill these from other rows because
-- there's no canonical source — they'd need operator triage if any exist.
do $$
declare
  t text;
  cnt int;
  cols text[] := array[
    'users.firm_id',
    'cases.firm_id',
    'documents.firm_id',
    'tasks.firm_id',
    'alerts.firm_id',
    'clients.firm_id',
    'leads.firm_id',
    'invoices.firm_id',
    'expenses.firm_id',
    'limitations.firm_id',
    'diary_entries.firm_id',
    'drafts.firm_id'
  ];
  pair text;
  table_name text;
  column_name text;
begin
  foreach pair in array cols loop
    table_name := split_part(pair, '.', 1);
    column_name := split_part(pair, '.', 2);
    execute format('select count(*) from %I where %I is null', table_name, column_name) into cnt;
    if cnt = 0 then
      execute format('alter table %I alter column %I set not null', table_name, column_name);
    else
      raise notice
        'Skipping NOT NULL on %.% — % null rows remain (resolve manually then re-run)',
        table_name, column_name, cnt;
    end if;
  end loop;
end $$;

-- users.firm_id FK behaviour: switch to ON DELETE RESTRICT so firm
-- deletion can't orphan users (current ON DELETE SET NULL leaves rows
-- with firm_id = NULL that satisfy zero tenant scopes). We drop+re-add
-- because Postgres has no `alter constraint` for FK rules.
do $$
begin
  alter table users drop constraint users_firm_id_fkey;
exception when undefined_object then null;
end $$;

do $$
begin
  alter table users
    add constraint users_firm_id_fkey
    foreign key (firm_id) references firms(id) on delete restrict;
exception when duplicate_object then null;
end $$;

-- users(firm_id) index — every per-firm user listing currently scans the
-- full users table.
create index if not exists users_firm_idx on users (firm_id);

-- =============================================================================
-- (4) Money columns → bigint
-- =============================================================================
-- All amounts in `amount_inr` / `value_inr` columns. int4 maxes at ~₹21.4 cr;
-- analytics views (0021) already sum as bigint but the writer side wraps.
-- ALTER TYPE on plain numeric columns is fast (no row rewrite when the new
-- type has same alignment / wider precision).
--
-- `analytics_monthly_revenue_mv` depends on `invoices.amount_inr`, so we
-- drop it, alter the column, then recreate the view + its indexes. The
-- view is empty until the analytics refresh job runs anyway, so dropping
-- it is harmless. Same shape as the original definition in 0021.

drop materialized view if exists analytics_monthly_revenue_mv;

alter table invoices    alter column amount_inr type bigint;
alter table expenses    alter column amount_inr type bigint;
alter table leads       alter column value_inr  type bigint;

create materialized view if not exists analytics_monthly_revenue_mv as
  select
    firm_id,
    extract(year  from issued_date)::int as y,
    extract(month from issued_date)::int as m,
    coalesce(sum(amount_inr), 0)::bigint as total
  from invoices
  where firm_id is not null
    and status in ('paid', 'pending', 'overdue')
  group by firm_id, y, m;

create unique index if not exists analytics_monthly_revenue_mv_firm_ym_idx
  on analytics_monthly_revenue_mv (firm_id, y, m);

create index if not exists analytics_monthly_revenue_mv_firm_idx
  on analytics_monthly_revenue_mv (firm_id);

-- =============================================================================
-- (5) File-size columns → bigint
-- =============================================================================

do $$ begin
  alter table case_notes alter column file_size type bigint;
exception when undefined_column then null; end $$;

do $$ begin
  alter table mock_argument_uploads alter column file_size type bigint;
exception when undefined_column then null; end $$;

do $$ begin
  alter table data_export_log alter column total_bytes type bigint;
exception when undefined_column then null; end $$;

-- =============================================================================
-- (6) Other indexes the audit flagged
-- =============================================================================

-- alerts has no `status` column (the audit assumed one) — alerts are
-- immutable notifications, dismissed only by client-side state. The
-- existing alerts_firm_idx is sufficient.

create index if not exists invitations_firm_status_idx
  on invitations (firm_id, status);

-- firms has no `status` column today (the audit assumed one) — the trial
-- expiry job just runs `where trial_ends_at < now()`, so the partial index
-- only needs the null-exclusion clause.
create index if not exists firms_trial_expiry_idx
  on firms (trial_ends_at)
  where trial_ends_at is not null;
