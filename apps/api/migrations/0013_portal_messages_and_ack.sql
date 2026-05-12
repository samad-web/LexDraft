-- =============================================================================
-- LexDraft — Client portal: messages thread + document acknowledgement
-- =============================================================================
-- CLIENT_PORTAL.md §4.5 (acknowledge receipt) and §4.7 (messages).
--
--   * documents.requires_acknowledgement / signed_at / signed_by_client_id
--       — adds the "lightweight signature" semantics for documents the
--         firm flags as needing client acknowledgement
--   * portal_messages
--       — one row per message; threaded by (firm_id, client_id, matter_id),
--         where matter_id is null for the per-client "general" thread
--
-- Idempotent.
-- =============================================================================

-- ---- documents — acknowledgement flags -------------------------------------

alter table documents
  add column if not exists requires_acknowledgement boolean not null default false;
alter table documents
  add column if not exists signed_at timestamptz;
alter table documents
  add column if not exists signed_by_client_id uuid references clients(id) on delete set null;

create index if not exists documents_pending_ack_idx
  on documents (firm_id, requires_acknowledgement)
  where requires_acknowledgement = true and signed_at is null;

-- ---- portal_messages -------------------------------------------------------

create table if not exists portal_messages (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references firms(id) on delete cascade,
  client_id    uuid not null references clients(id) on delete cascade,
  /* null = "general" thread (non-matter-specific) */
  matter_id    uuid references cases(id) on delete set null,
  /* who sent: 'client' (portal session) or 'firm' (firm-side user) */
  sender_kind  text not null check (sender_kind in ('client', 'firm')),
  /* clientId for client, userId for firm. Stored as uuid for consistency. */
  sender_id    uuid not null,
  /* denormalised display name to avoid a join on every message render */
  sender_name  text not null,
  body         text not null check (length(body) between 1 and 4000),
  sent_at      timestamptz not null default now(),
  /* recipient-read marker — null = unread by the other side */
  read_at      timestamptz
);

create index if not exists portal_messages_thread_idx
  on portal_messages (firm_id, client_id, matter_id, sent_at desc);
create index if not exists portal_messages_unread_idx
  on portal_messages (firm_id, client_id, matter_id, sender_kind)
  where read_at is null;

-- ---- demo seed: flag one of the seeded documents as requiring ack ----------
-- Picks any document on the seed firm so the portal Acknowledge button has
-- something to bind to in dev — production migrations have no rows yet, so
-- this is a no-op there.

update documents
  set requires_acknowledgement = true
  where firm_id = '00000000-0000-0000-0000-000000000001'::uuid
    and requires_acknowledgement = false
    and id in (
      select id from documents
      where firm_id = '00000000-0000-0000-0000-000000000001'::uuid
      order by created_at desc
      limit 1
    );
