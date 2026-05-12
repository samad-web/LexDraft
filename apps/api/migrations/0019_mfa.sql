-- =============================================================================
-- LexDraft — TOTP-based multi-factor authentication (spec §10)
-- =============================================================================
-- Adds MFA state to users + a short-lived challenge table used for the
-- "password verified, awaiting TOTP" handshake during sign-in.
--
-- MFA is REQUIRED for Firm Admin and superadmin roles, optional for the
-- rest of the workforce. The `mfa_required_at` timestamp is set by the
-- admin/role-promotion flow; the actual enforcement lives in the auth
-- service + requireMfa middleware (not in this schema).
--
-- Idempotent — `add column if not exists`, `create index if not exists`,
-- `create table if not exists` so re-runs are safe.
-- =============================================================================

-- ---- users.* MFA columns ---------------------------------------------------
-- totp_secret: base32-encoded shared secret, written ONLY after a successful
-- enrolment confirmation. The provisional secret used during the brief
-- enrolment window lives in mfa_pending_challenges (or process memory) and
-- never lands here until proven by a valid TOTP code.
alter table users add column if not exists totp_secret        text;
alter table users add column if not exists mfa_enrolled_at    timestamptz;
alter table users add column if not exists mfa_required_at    timestamptz;
-- bcrypt-hashed single-use backup codes. Plaintext is shown to the user
-- ONCE at enrol time; this column only ever stores the hashes. A code is
-- "consumed" by removing its hash from the array.
alter table users add column if not exists mfa_backup_codes   text[];

-- ---- mfa_pending_challenges ------------------------------------------------
-- Short-lived (5-minute TTL) handshakes between password verification and
-- TOTP verification at sign-in time. Also reused as the storage for the
-- provisional enrolment secret so a server restart doesn't leak it
-- in-process. `consumed_at` is set when the row is exchanged for a real
-- session token — replaying the same challengeId after that is rejected.
create table if not exists mfa_pending_challenges (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  -- Optional provisional TOTP secret for enrolment-in-progress rows. NULL
  -- for sign-in handshake rows (which only need to assert "this user just
  -- proved their password").
  pending_secret text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  consumed_at   timestamptz
);

create index if not exists mfa_pending_challenges_user_idx
  on mfa_pending_challenges (user_id);
create index if not exists mfa_pending_challenges_expires_idx
  on mfa_pending_challenges (expires_at);
