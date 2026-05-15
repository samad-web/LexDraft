-- =============================================================================
-- LexDraft - Client portal
-- =============================================================================
-- Read-only portal that lets clients see their own cases, hearings, invoices,
-- and documents. Auth is via magic link (passwordless): the client enters
-- their email, we mint a short-lived single-use token, email it (today: log
-- via the email.send job stub), and exchange it for a portal-scoped JWT.
--
--   * clients.email                  - destination for the magic link
--   * client_portal_sessions         - magic-link tokens (hashed)
--
-- Idempotent.
-- =============================================================================

alter table clients add column if not exists email text;
create index if not exists clients_email_idx on clients (lower(email))
  where email is not null;

create table if not exists client_portal_sessions (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  firm_id      uuid not null references firms(id) on delete cascade,
  email        text not null,
  /* sha256 of the random token. Plaintext is only sent in the magic link;
   * we never store it, so a leaked DB doesn't surrender active links. */
  token_hash   bytea not null,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists client_portal_sessions_token_idx
  on client_portal_sessions (token_hash) where used_at is null;
create index if not exists client_portal_sessions_client_idx
  on client_portal_sessions (client_id, created_at desc);
