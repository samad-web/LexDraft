-- =============================================================================
-- LexDraft — DPDP Act 2023 compliance schema
-- =============================================================================
-- Adds the storage primitives the data-principal endpoints depend on:
--
--   (a) Soft-delete + scheduled purge on every user-owned / firm-owned domain
--       table. `deleted_at` flags the row as deactivated; `scheduled_purge_at`
--       gives operations a retention window (default 30d) before a daily
--       background job hard-deletes. The two-step lets us recover from
--       accidental deletion and satisfies a legal-hold pause.
--
--   (b) `consent_log` — append-only ledger of every consent grant/withdrawal
--       so we can prove what the data principal agreed to at any moment.
--       Versioned via (consent_type, consent_version) tuples.
--
--   (c) `audit_log.retain_until` — extends the existing audit table with a
--       retention deadline so the purger can drop entries past their TTL
--       (default 7 years, set at write time by audit.service.ts).
--
--   (d) `data_export_log` — proves an export was generated for a given user
--       at a given time. Required artifact under DPDP §11(1).
--
-- Idempotent. Every domain-table ALTER is guarded by a do-block that checks
-- information_schema first, because not every table exists at the same
-- revision (e.g. demo Postgres pinned at an older migration).
-- =============================================================================

-- ---- soft-delete columns on user-owned / firm-owned domain tables -----------
-- The same triplet (column, column, partial index) is applied to every table
-- listed. Wrapped in a do-block because `alter table` has no "if not exists"
-- for the table itself, only the column.
do $$
declare
  t text;
  tables text[] := array[
    'users','drafts','documents','clients','cases','clauses','leads',
    'invoices','expenses','limitations','diary_entries','tasks',
    'physical_documents'
  ];
begin
  foreach t in array tables loop
    if exists (select 1 from information_schema.tables where table_name = t) then
      execute format('alter table %I add column if not exists deleted_at timestamptz null', t);
      execute format('alter table %I add column if not exists scheduled_purge_at timestamptz null', t);
      execute format(
        'create index if not exists %I on %I (deleted_at) where deleted_at is not null',
        t || '_deleted_idx', t
      );
      execute format(
        'create index if not exists %I on %I (scheduled_purge_at) where scheduled_purge_at is not null',
        t || '_purge_idx', t
      );
    end if;
  end loop;
end $$;

-- ---- consent ledger ---------------------------------------------------------
create table if not exists consent_log (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references users(id) on delete cascade,
  firm_id         uuid references firms(id) on delete cascade,
  -- Free-text classifier — e.g. 'tos_v1', 'dpdp_processing', 'marketing_opt_in'.
  -- Not enumerated so product can add categories without a migration.
  consent_type    text not null,
  consent_version text not null,
  granted         boolean not null,
  ip              text,
  user_agent      text,
  created_at      timestamptz not null default now()
);
create index if not exists consent_log_user_idx on consent_log (user_id, created_at desc);
create index if not exists consent_log_firm_idx on consent_log (firm_id, created_at desc);
create index if not exists consent_log_type_idx on consent_log (consent_type, created_at desc);

-- ---- audit_log retention extension ------------------------------------------
alter table audit_log add column if not exists retain_until timestamptz null;
create index if not exists audit_log_retain_idx on audit_log (retain_until) where retain_until is not null;

-- ---- data export request log ------------------------------------------------
create table if not exists data_export_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  requested_at  timestamptz not null default now(),
  completed_at  timestamptz null,
  total_bytes   integer null,
  ip            text,
  user_agent    text
);
create index if not exists data_export_log_user_idx on data_export_log (user_id, requested_at desc);
