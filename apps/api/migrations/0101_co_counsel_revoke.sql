-- =============================================================================
-- 0101_co_counsel_revoke.sql
-- =============================================================================
-- Co-Counsel lockdown (build-docs/features/co-counsel-lockdown.md): a referring
-- firm can revoke an accepted handover and a guest can leave one. The request
-- row records that as status 'revoked'; the access row (case_guest_grants)
-- already has its own 'revoked' status from 0073.
--
-- Additive only. Idempotent.
-- =============================================================================

alter type handover_status add value if not exists 'revoked';
