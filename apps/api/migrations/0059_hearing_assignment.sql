-- =============================================================================
-- 0059_hearing_assignment.sql
-- =============================================================================
-- Per-hearing assignment, so a specific hearing can be handed to a colleague
-- (e.g. when the lead advocate is unavailable on that date) independently of
-- who leads the overall matter.
--
-- Case-level "lead advocate" assignment already has a home: the existing
-- `case_assignments` table (case_id, user_id, role_on_case='lead', migration
-- 0049). This migration only adds the per-hearing override.
--
-- Nullable + ON DELETE SET NULL: an unassigned hearing falls back to the
-- matter's lead, and deleting a user leaves their hearings intact (just
-- unassigned) rather than cascading the hearings away.
-- =============================================================================

alter table hearings
  add column if not exists assigned_to_user_id uuid references users(id) on delete set null;

create index if not exists hearings_assignee_idx
  on hearings (assigned_to_user_id);
