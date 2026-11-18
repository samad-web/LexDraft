-- =============================================================================
-- 0118 team-work (owner 2026-11-18): tasks are assigned to a real member.
--   assignee_user_id    who the task is for (the assignee text stays: initials
--                       shown on the board, and old rows keep working)
--   created_by_user_id  who assigned it ("Assigned by me")
-- Additive and idempotent. Nothing existing is changed or removed.
-- =============================================================================
alter table tasks
  add column if not exists assignee_user_id   uuid references users(id) on delete set null,
  add column if not exists created_by_user_id uuid references users(id) on delete set null;

create index if not exists tasks_firm_assignee_idx on tasks (firm_id, assignee_user_id);
