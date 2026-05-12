-- =============================================================================
-- LexDraft — Client portal: opt-in visibility flags
-- =============================================================================
-- Per CLIENT_PORTAL.md §4.5 ("opt-in per document, not per matter") and §7.1
-- (firm-side toggles). Until now the portal exposed every case/document/
-- invoice tied to a client by name match — that was fine for demo, wrong
-- for prod. This migration introduces explicit allow-flags:
--
--   * clients.portal_enabled        — allow magic-link sign-in for this client
--   * cases.visible_to_client       — show this matter in the portal
--   * documents.shared_with_client  — surface this document in the portal
--
-- Invoice visibility is derived: status != 'draft'. No new column.
--
-- Defaults: false (closed by default). The migration also flips the flags
-- on the seeded demo rows so the existing dev experience continues to work.
--
-- Idempotent.
-- =============================================================================

alter table clients
  add column if not exists portal_enabled boolean not null default false;
create index if not exists clients_portal_enabled_idx
  on clients (firm_id) where portal_enabled = true;

alter table cases
  add column if not exists visible_to_client boolean not null default false;
create index if not exists cases_portal_visible_idx
  on cases (firm_id, client) where visible_to_client = true;

alter table documents
  add column if not exists shared_with_client boolean not null default false;
create index if not exists documents_shared_idx
  on documents (firm_id, case_label) where shared_with_client = true;

-- ---- demo seed: enable the flags on the existing seed-firm rows ------------
-- Production migrations have nothing to flip here (no rows yet); for dev the
-- seed firm has a Sharma & Associates client whose matters/docs the portal
-- demo expects to see.

update clients
  set portal_enabled = true
  where firm_id = '00000000-0000-0000-0000-000000000001'::uuid
    and portal_enabled = false;

update cases
  set visible_to_client = true
  where firm_id = '00000000-0000-0000-0000-000000000001'::uuid
    and visible_to_client = false;

update documents
  set shared_with_client = true
  where firm_id = '00000000-0000-0000-0000-000000000001'::uuid
    and shared_with_client = false;
