-- =============================================================================
-- 0084_field_encryption_email_lookup.sql
-- =============================================================================
-- Part of the field-level encryption rollout (esign_signers.name/email/
-- signed_ip, clients.email). clients.email and esign_signers.* stay `text`
-- columns storing ciphertext (v1:<iv>:<tag>:<ciphertext>, see
-- src/lib/field-crypto.ts) - no column-type change needed, ciphertext is
-- just a longer string in the same column.
--
-- The one schema change this DOES require: clients_email_idx was a
-- case-insensitive index built for the portal login lookup
-- (`where lower(email) = ...` in portal.service.ts). Once `email` holds
-- ciphertext, `lower(email)` is lowercasing base64 noise - the index becomes
-- both useless and misleading, so it's dropped here.
--
-- Replacement: a deterministic one-way HMAC "blind index" column
-- (email_lookup_hash). Login now queries `where email_lookup_hash =
-- hmacEmailLookup(input)` instead of comparing plaintext/ciphertext email
-- directly - exact-match lookup still works without ever decrypting the
-- whole table on every sign-in attempt, and the hash reveals nothing about
-- the email itself (HMAC, not reversible, unlike the AES-GCM email column).
--
-- Nullable, since not every client row has an email. Backfilled by
-- scripts/encrypt-existing-fields.ts alongside the email ciphertext itself
-- (both derived from the same plaintext in the same pass).
-- =============================================================================

drop index if exists clients_email_idx;

alter table clients add column if not exists email_lookup_hash text;

create index if not exists clients_email_lookup_hash_idx
  on clients (email_lookup_hash)
  where email_lookup_hash is not null;
