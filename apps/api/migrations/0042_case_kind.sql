-- 0042_case_kind.sql
--
-- Adds `kind` + `created_by_user_id` to `cases` so Matter Intelligence can
-- spin up lightweight "quick study" sandboxes without polluting the real
-- matters list.
--
-- Sandbox cases (`kind = 'sandbox'`) are private to the user who created
-- them and are filtered out of every "list cases" surface (Cases view,
-- Clients, Leads, billing aggregates, analytics). They still live in the
-- `cases` table so the existing matter-intel pipeline (matter_documents,
-- matter_briefs, matter_chat_threads, etc.) works unchanged — the only
-- difference is the visibility rule applied by the API layer.

-- Default 'matter' so every existing row keeps its current semantics.
alter table cases
  add column if not exists kind text not null default 'matter';

alter table cases
  add constraint cases_kind_check
  check (kind in ('matter', 'sandbox'))
  not valid;

alter table cases validate constraint cases_kind_check;

-- Author of a sandbox so each user only sees their own quick studies.
-- Nullable because (a) real matters don't carry an author today and
-- (b) we don't want a NOT NULL on a back-filled column.
alter table cases
  add column if not exists created_by_user_id uuid
  references users(id) on delete set null;

-- Index for the quick-studies list lookup: (firm, kind, creator, recency).
create index if not exists cases_sandbox_idx
  on cases (firm_id, kind, created_by_user_id, created_at desc)
  where kind = 'sandbox';
