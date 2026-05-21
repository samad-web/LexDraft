-- =============================================================================
-- 0039_mock_arguments_language.sql
-- =============================================================================
-- Multi-language support for Mock Arguments.
--
--   - mock_argument_sessions.language_code  : BCP-47 code chosen at session
--     start. Threaded into every LLM prompt (opening, opposing counsel,
--     review) so the whole session plays back in the chosen tongue. Defaults
--     to 'en-IN' so any rows that predate this migration keep working.
--
--   - users.default_language_code           : User-level preference. Pre-fills
--     the per-session picker. Defaults to 'en-IN' so existing accounts stay
--     in English until they pick something else from Settings.
--
-- We store BCP-47 strings ('hi-IN', 'ta-IN', ...) rather than an enum because
-- the LANGUAGES catalogue lives client-side and the API only ever needs to
-- (a) round-trip the value and (b) look up a display name for the prompt
-- directive. A free-text column + lookup table at the app layer keeps
-- adding/removing supported languages a code-only change.
-- =============================================================================

alter table mock_argument_sessions
  add column if not exists language_code text not null default 'en-IN';

alter table users
  add column if not exists default_language_code text not null default 'en-IN';
