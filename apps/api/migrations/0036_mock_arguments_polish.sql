-- =============================================================================
-- 0036_mock_arguments_polish.sql
-- =============================================================================
-- Polish pass over the Mock Arguments tables added in 0035:
--
--   1. Rolling summary column on mock_argument_sessions. The service rewrites
--      this every 4 turns so prompts stay bounded as a session grows — the
--      pinned matter summary + rolling summary of older turns + last few
--      verbatim turns is enough context without re-sending the full transcript.
--
--   2. last_summarized_turn — bookkeeping so the service knows from which
--      turn the next rolling-summary pass should start. Avoids re-summarising
--      turns already folded into the existing rolling_summary.
--
-- Both are nullable / default-safe so this migration is backward compatible
-- with sessions created under 0035.
-- =============================================================================

alter table mock_argument_sessions
  add column if not exists rolling_summary text,
  add column if not exists last_summarized_turn integer not null default 0;
