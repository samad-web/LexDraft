-- =============================================================================
-- 0037_mock_arguments_review_raw.sql
-- =============================================================================
-- Persist the raw LLM response that produced each review row. Two reasons:
--
--   1. Debuggability when scores come out empty / wrong shape — the UI can
--      surface the raw response and the user can copy it for a bug report
--      without needing terminal access to the API logs.
--   2. Future re-parsing without re-prompting — if we tighten the parser
--      later, we can re-run coerceRubric over the saved raw_response and
--      back-fill rubric_jsonb without burning another LLM call.
--
-- Nullable + default null so the column is backward-compatible with the
-- handful of review rows that landed before this migration.
-- =============================================================================

alter table mock_argument_reviews
  add column if not exists llm_raw_response text;
