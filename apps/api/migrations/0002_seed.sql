-- =============================================================================
-- LexDraft — base data
-- =============================================================================
-- Seeds only the default firm row that the auth service expects (referenced as
-- SEED_FIRM_ID by auth.service.ts when provisioning new users). All sample
-- cases, hearings, alerts, documents, and tasks have been removed — the app
-- starts blank and is populated through normal use.
-- Idempotent: only inserts when the firms table is empty.
-- =============================================================================

insert into firms (id, name, seats)
select '00000000-0000-0000-0000-000000000001', 'Sharma & Associates', 8
where not exists (select 1 from firms);
