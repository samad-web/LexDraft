-- =============================================================================
-- 0074_co_counsel_open_link.sql
-- =============================================================================
-- Co-Counsel handover, round 2: replace "type the receiving advocate's email
-- up front" with a shareable link/QR code the referring advocate generates
-- and sends however they like (WhatsApp, in person, etc). The recipient is
-- unknown until they actually open the link and fill in their own name,
-- email, and password.
--
-- This means `invitations.email` can no longer be NOT NULL - an open-link
-- invitation has no email at creation time, only at acceptance. Firm-member
-- invites (kind='firm_member') and the original email-first co-counsel path
-- (kind='co_counsel_handover' with an email) are unaffected; both still set
-- email at creation and this migration doesn't touch their behaviour.
--
-- `handover_target_kind` gains 'open_link': target_user_id, target_name,
-- target_email all stay null until accept() backfills them.
--
-- Idempotent.
-- =============================================================================

alter table invitations alter column email drop not null;

-- lower(email) is still unique among rows that HAVE an email - open-link
-- invitations (email is null) are simply excluded from a unique index by
-- Postgres's standard NULL handling, so no conflict risk between multiple
-- open-link invites.

-- `add value if not exists` is itself idempotent; no further guard needed.
-- Safe inside this migration's transaction because 'open_link' isn't
-- referenced by any other statement in this same file.
alter type handover_target_kind add value if not exists 'open_link';
