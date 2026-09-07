-- =============================================================================
-- 0065_cases_soft_delete — recoverable matter deletion with a 30-day window.
--
-- Deleting a matter is destructive and, in legal software, must be reversible:
-- a matter deleted by mistake has to be restorable. Instead of a hard DELETE we
-- mark the row `deleted_at`; the normal case list excludes deleted rows, a
-- "Recently deleted" view lists them, and restore clears the flag. A row whose
-- deleted_at is older than 30 days is eligible for permanent purge (a scheduled
-- job / manual purge removes it).
-- =============================================================================

alter table cases add column if not exists deleted_at timestamptz;

-- Partial index: fast lookup of live rows (the common path) without indexing
-- the soft-deleted tail.
create index if not exists cases_firm_live_idx
  on cases (firm_id) where deleted_at is null;

-- And an index for the trash view / purge sweep.
create index if not exists cases_deleted_at_idx
  on cases (deleted_at) where deleted_at is not null;
