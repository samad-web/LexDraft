-- 0022_limitation_statute.sql
--
-- Statute-aware limitation engine: extends the existing `limitations` table
-- with the metadata a matter-type-driven calculator needs to surface the
-- legal basis next to each tracked deadline.
--
--   matter_type    -- the curated rule id used (e.g. "Recovery of money — oral contract")
--   basis_statute  -- 'Limitation Act 1963', 'NI Act 1881', 'Consumer Protection Act 2019', …
--   basis_section  -- 'Article 18', '§138 NI Act', 'Article 113'
--   computed_from  -- the trigger date the deadline was calculated from
--
-- All columns are nullable so existing rows continue to work unchanged; the
-- new fields are only populated when a deadline is added through the
-- matter-type picker rather than typed in by hand.
--
-- Idempotent: every alter / index guards with `if not exists`.

alter table limitations add column if not exists matter_type    text;
alter table limitations add column if not exists basis_statute  text;
alter table limitations add column if not exists basis_section  text;
alter table limitations add column if not exists computed_from  date;

create index if not exists limitations_matter_type_idx
  on limitations (firm_id, matter_type);
