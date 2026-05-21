-- =============================================================================
-- LexDraft - Client portal: password sign-in
-- =============================================================================
-- Replaces the magic-link auth flow (migrations 0011/0013) with a plain
-- password. On "Enable portal" the firm admin gets back a generated default
-- password of the form `firstname@123` to share with the client. The bcrypt
-- hash is the source of truth - the plaintext is only ever in the API
-- response body for the firm admin to copy.
--
-- The `client_portal_sessions` table from 0011 is left in place (kept so
-- existing in-flight links can finish verifying without a 500 if any are
-- outstanding), but no new rows are written - it is effectively dead and
-- safe to drop in a future migration once a maintenance window allows it.
--
-- Idempotent.
-- =============================================================================

alter table clients add column if not exists portal_password_hash text;
