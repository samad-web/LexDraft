-- =============================================================================
-- 0038_mock_arguments_improvements.sql
-- =============================================================================
-- Adds the `improvements_jsonb` column to mock_argument_reviews. This carries
-- the LLM-generated "Where to improve" array — concrete rewrites of the
-- advocate's weakest user-turns plus a projected score lift, surfaced in the
-- review UI so the user can see how to argue better rather than just
-- learning what they got wrong.
--
-- Default '[]'::jsonb so the column is backward-compatible with rows that
-- predate this migration; rowToReview falls back to re-parsing the raw LLM
-- response when present, so existing reviews surface improvements as soon as
-- the new prompt is in effect.
-- =============================================================================

alter table mock_argument_reviews
  add column if not exists improvements_jsonb jsonb not null default '[]'::jsonb;
