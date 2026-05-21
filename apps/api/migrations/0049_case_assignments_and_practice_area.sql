-- =============================================================================
-- LexDraft - Member ↔ case assignment + practice-area revenue
-- =============================================================================
-- Two related fixes for the Firm dashboard:
--
-- 1. case_assignments — links cases to the users working them, so the Firm
--    Members table can show real "Active matters" instead of a column of zeros.
--    Each row also carries a `role_on_case` (lead / collaborator / observer)
--    in case we ever want to distinguish primary advocate from support.
--
-- 2. cases.practice_area — a stable categorical for the Practice Mix panel,
--    distinct from the free-text `type` (which is "Civil Suit" / "Writ Petition"
--    granularity). The catalog: 'Litigation', 'Corporate', 'IP', 'Family',
--    'Criminal', 'Tax', 'Real Estate', 'Employment', 'Other'. Optional.
--
-- Idempotent.
-- =============================================================================

create table if not exists case_assignments (
  case_id        uuid not null references cases(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  role_on_case   text not null default 'lead' check (role_on_case in ('lead', 'collaborator', 'observer')),
  assigned_at    timestamptz not null default now(),
  primary key (case_id, user_id)
);

create index if not exists case_assignments_user_idx on case_assignments (user_id);

-- Free-text practice area. Allowed values are advisory at the DB layer; we
-- enforce in code via `cases.types.ts` so the catalog can evolve without a
-- migration each time. Null = uncategorised, which lets the dashboard fold
-- "Other" automatically.
alter table cases add column if not exists practice_area text;
create index if not exists cases_practice_area_idx on cases (practice_area) where practice_area is not null;
