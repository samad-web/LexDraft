-- =============================================================================
-- LexDraft — rename task priorities from color names to semantic levels
-- =============================================================================
-- Maps:
--   vermillion -> very_high   (most urgent — was red/danger)
--   amber      -> high        (was orange/warning)
--   cobalt     -> medium      (was blue/info — this is also the new default)
--   sage       -> low         (was green/success)
--   muted      -> low         (was grey/none — folded into low)
--
-- Postgres-safe enum migration: rename old enum aside, create new, convert
-- the column in place via CASE, then drop the old enum.
-- =============================================================================

do $$
begin
  -- Skip the entire block if the new enum already exists from a previous run.
  if not exists (select 1 from pg_type where typname = 'task_priority' and exists (
                 select 1 from pg_enum where enumtypid = pg_type.oid and enumlabel = 'very_high')) then

    alter type task_priority rename to task_priority_old;

    create type task_priority as enum ('very_high', 'high', 'medium', 'low');

    alter table tasks alter column priority drop default;
    alter table tasks
      alter column priority type task_priority using (
        case priority::text
          when 'vermillion' then 'very_high'::task_priority
          when 'amber'      then 'high'::task_priority
          when 'cobalt'     then 'medium'::task_priority
          when 'sage'       then 'low'::task_priority
          when 'muted'      then 'low'::task_priority
          else 'medium'::task_priority
        end
      );
    alter table tasks alter column priority set default 'medium'::task_priority;

    drop type task_priority_old;
  end if;
end $$;
