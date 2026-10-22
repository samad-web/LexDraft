-- =============================================================================
-- 0089_matter_links.sql
-- =============================================================================
-- Give tasks, limitations and expenses a real link to their matter.
--
-- Until now these rows only carried the matter's title as text (case_label;
-- limitations also a cnr), so the case page matched them by string and lost
-- them when a matter was renamed. This adds a nullable `case_id`.
--
-- ADDITIVE ONLY (approved by the user 2026-10-21):
--   - new nullable columns + indexes, `on delete set null` (deleting a matter
--     never deletes a task/deadline/expense)
--   - one helper function + BEFORE triggers that fill case_id when it is
--     null, from an UNAMBIGUOUS match only (exactly one live matter in the
--     same firm with that CNR, else that title - case/space-insensitive)
--   - a one-time backfill that only writes the new column where it is null
-- No existing column is modified, no row is deleted.
-- =============================================================================

alter table tasks       add column if not exists case_id uuid references cases(id) on delete set null;
alter table limitations add column if not exists case_id uuid references cases(id) on delete set null;
alter table expenses    add column if not exists case_id uuid references cases(id) on delete set null;

create index if not exists tasks_case_id_idx       on tasks (case_id)       where case_id is not null;
create index if not exists limitations_case_id_idx on limitations (case_id) where case_id is not null;
create index if not exists expenses_case_id_idx    on expenses (case_id)    where case_id is not null;

-- The single matter in `p_firm` identified by CNR (preferred) or title, or
-- null when there is no match or more than one.
create or replace function matter_id_for_label(p_firm uuid, p_label text, p_cnr text default null)
returns uuid
language sql
stable
as $$
  select coalesce(
    (select case when count(*) = 1 then min(id::text)::uuid end
       from cases
      where firm_id = p_firm and deleted_at is null
        and nullif(trim(p_cnr), '') is not null
        and upper(trim(cnr)) = upper(trim(p_cnr))),
    (select case when count(*) = 1 then min(id::text)::uuid end
       from cases
      where firm_id = p_firm and deleted_at is null and kind = 'matter'
        and nullif(trim(p_label), '') is not null
        and lower(trim(title)) = lower(trim(p_label)))
  );
$$;

-- Fill case_id on insert, and re-resolve when the label changes and the
-- caller didn't set case_id explicitly.
create or replace function fill_matter_link()
returns trigger
language plpgsql
as $$
declare
  v_cnr text := null;
begin
  if tg_table_name = 'limitations' then
    v_cnr := new.cnr;
  end if;
  if new.case_id is null then
    new.case_id := matter_id_for_label(new.firm_id, new.case_label, v_cnr);
  elsif tg_op = 'UPDATE'
        and new.case_label is distinct from old.case_label
        and new.case_id is not distinct from old.case_id then
    -- Label moved to another matter without an explicit case_id.
    new.case_id := matter_id_for_label(new.firm_id, new.case_label, v_cnr);
  end if;
  return new;
end;
$$;

do $$ begin
  create trigger trg_tasks_matter_link before insert or update on tasks
    for each row execute function fill_matter_link();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_limitations_matter_link before insert or update on limitations
    for each row execute function fill_matter_link();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_expenses_matter_link before insert or update on expenses
    for each row execute function fill_matter_link();
exception when duplicate_object then null; end $$;

-- One-time backfill of the new column only. The updated_at triggers are
-- paused so existing rows keep their timestamps (only case_id changes), and
-- only rows with an unambiguous match are touched.
alter table tasks       disable trigger trg_tasks_updated;
alter table limitations disable trigger trg_limitations_updated;
alter table expenses    disable trigger trg_expenses_updated;

update tasks       set case_id = matter_id_for_label(firm_id, case_label)
 where case_id is null and matter_id_for_label(firm_id, case_label) is not null;
update limitations set case_id = matter_id_for_label(firm_id, case_label, cnr)
 where case_id is null and matter_id_for_label(firm_id, case_label, cnr) is not null;
update expenses    set case_id = matter_id_for_label(firm_id, case_label)
 where case_id is null and matter_id_for_label(firm_id, case_label) is not null;

alter table tasks       enable trigger trg_tasks_updated;
alter table limitations enable trigger trg_limitations_updated;
alter table expenses    enable trigger trg_expenses_updated;
