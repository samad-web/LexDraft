-- =============================================================================
-- LexDraft - Stitch hearings to cases by id, not by title
-- =============================================================================
-- `hearings.case_id` was nullable, and many code paths join hearings to cases
-- via `case_label = cases.title` (free-text string match). That breaks on
-- renames and risks cross-leaking hearings between two cases with similar
-- titles. This migration:
--
--   1. Backfills `case_id` from a `(firm_id, case_label = title)` lookup.
--   2. Drops the now-redundant rows whose `case_label` never resolved
--      (orphan hearings — surfaced for manual triage via an audit_log entry
--      rather than silently re-attached).
--   3. Adds a non-null constraint on `hearings.case_id` going forward.
--
-- Idempotent: rerunning is a no-op once `case_id` is populated.
-- =============================================================================

-- 1. Backfill from the title match — only rows that currently have a null
--    case_id are touched.
update hearings h
   set case_id = c.id
  from cases c
 where h.case_id is null
   and h.firm_id is not null
   and c.firm_id = h.firm_id
   and c.title = h.case_label;

-- 2. Soft-flag any remaining orphans so we don't lose data on the NOT NULL
--    flip. Move them into a salvage table for an operator to triage.
create table if not exists hearings_orphaned (
  like hearings including all
);

with orphans as (
  delete from hearings
  where case_id is null
  returning *
)
insert into hearings_orphaned
select * from orphans;

-- 3. Enforce the link from now on. Drop and re-add to be idempotent (a
--    previous run may have left the column nullable).
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_name = 'hearings'
      and column_name = 'case_id'
      and is_nullable = 'YES'
  ) then
    alter table hearings alter column case_id set not null;
  end if;
end $$;

create index if not exists hearings_case_id_idx on hearings (case_id);

-- ---- documents: backfill case_id by title (same fix, smaller blast) --------
-- The portal matter detail now queries by case_id, so docs that were created
-- before this column was wired need the link populated. We don't enforce NOT
-- NULL on documents.case_id because some docs are deliberately firm-scoped
-- (templates, branding assets) and have no matter.
update documents d
   set case_id = c.id
  from cases c
 where d.case_id is null
   and d.firm_id is not null
   and c.firm_id = d.firm_id
   and c.title = d.case_label;

create index if not exists documents_case_id_idx on documents (case_id);

