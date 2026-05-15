-- =============================================================================
-- LexDraft - Client portal: per-client preferences (language, notifications)
-- =============================================================================
-- CLIENT_PORTAL.md §4.8 - the portal Profile screen exposes a small set of
-- preferences. Storing them as jsonb on `clients` keeps the schema thin (one
-- column, no new table) while leaving room for future keys without further
-- migrations.
--
-- Shape (validated server-side, not by the DB):
--   {
--     "language": "en",
--     "notifications": {
--       "newDocument":     true,
--       "hearingReminder": true,
--       "newMessage":      true,
--       "invoiceIssued":   true,
--       "invoiceOverdue":  true
--     }
--   }
--
-- Idempotent.
-- =============================================================================

alter table clients
  add column if not exists portal_preferences jsonb not null default '{}'::jsonb;
