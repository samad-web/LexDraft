-- =============================================================================
-- 0087_team_messaging.sql
-- =============================================================================
-- Internal (firm-side) team messaging. Three conversation kinds share one
-- data model:
--
--   direct  - 1:1 between two members of the same firm. `direct_key` is the
--             two user ids sorted and joined, so "open a DM with X" is an
--             idempotent upsert rather than a duplicate thread.
--   group   - named multi-person conversation inside the firm. Membership
--             lives in conversation_members; the creator is its first admin.
--   matter  - one discussion thread per case. Membership is NOT copied into
--             conversation_members: it is read live from case_assignments, so
--             the people assigned to a matter are always exactly the people in
--             its discussion (including co-counsel guests, who are assigned as
--             'collaborator' by the co-counsel flow). conversation_members rows
--             for a matter thread only carry per-user read state / mute.
--
-- Edit / delete model (WhatsApp-style, enforced in team-chat.service):
--   * Edit           - author only, within 15 minutes of sending. Every edit
--                      writes the previous body to message_edits, so the full
--                      history is retained for compliance even though readers
--                      only ever see the latest text plus an "Edited" label.
--   * Delete for me  - any message, any time. Hides it for that user only
--                      (message_hidden); nobody else is affected.
--   * Delete for     - author only, within 48 hours. Readers see "This message
--     everyone         was deleted". The original body stays in the row for
--                      the compliance record but is never returned by the API.
-- =============================================================================

create table if not exists conversations (
  id               uuid primary key default gen_random_uuid(),
  firm_id          uuid not null references firms(id) on delete cascade,
  kind             text not null check (kind in ('direct', 'group', 'matter')),
  case_id          uuid references cases(id) on delete cascade,
  title            text,
  direct_key       text,
  created_by       uuid references users(id) on delete set null,
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint conversations_matter_shape check ((kind = 'matter') = (case_id is not null)),
  constraint conversations_direct_shape check ((kind = 'direct') = (direct_key is not null))
);

-- One discussion per matter, one DM per pair of users per firm.
create unique index if not exists conversations_matter_uniq
  on conversations (case_id) where kind = 'matter';
create unique index if not exists conversations_direct_uniq
  on conversations (firm_id, direct_key) where kind = 'direct';
create index if not exists conversations_firm_recent_idx
  on conversations (firm_id, last_message_at desc nulls last);

do $$ begin
  create trigger trg_conversations_updated
    before update on conversations
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

create table if not exists conversation_members (
  conversation_id  uuid not null references conversations(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  role             text not null default 'member' check (role in ('admin', 'member')),
  joined_at        timestamptz not null default now(),
  -- Null = left the group. Rows are kept (not deleted) so a former member's
  -- read state and the membership history survive.
  left_at          timestamptz,
  last_read_at     timestamptz,
  muted            boolean not null default false,
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_idx
  on conversation_members (user_id) where left_at is null;

create table if not exists messages (
  id                       uuid primary key default gen_random_uuid(),
  firm_id                  uuid not null references firms(id) on delete cascade,
  conversation_id          uuid not null references conversations(id) on delete cascade,
  author_id                uuid references users(id) on delete set null,
  body                     text not null check (char_length(body) between 1 and 4000),
  reply_to_id              uuid references messages(id) on delete set null,
  -- [{ kind: 'document' | 'draft', id, name }] - references to existing
  -- firm documents/drafts, never uploaded bytes.
  attachments              jsonb not null default '[]'::jsonb,
  created_at               timestamptz not null default now(),
  edited_at                timestamptz,
  deleted_for_everyone_at  timestamptz
);

-- Thread view pages newest-first by (conversation, created_at).
create index if not exists messages_conversation_idx
  on messages (conversation_id, created_at desc);
create index if not exists messages_firm_idx on messages (firm_id);

-- Compliance history: every previous version of an edited message.
create table if not exists message_edits (
  id             uuid primary key default gen_random_uuid(),
  message_id     uuid not null references messages(id) on delete cascade,
  previous_body  text not null,
  edited_at      timestamptz not null default now()
);
create index if not exists message_edits_message_idx on message_edits (message_id);

-- "Delete for me".
create table if not exists message_hidden (
  message_id  uuid not null references messages(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  hidden_at   timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table if not exists message_mentions (
  message_id  uuid not null references messages(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  primary key (message_id, user_id)
);
create index if not exists message_mentions_user_idx on message_mentions (user_id);

-- ---- RBAC feature ----------------------------------------------------------
-- Available on every plan to every user (product decision), so it is a
-- baseline feature rather than a plan x role grant. Baseline also covers
-- co-counsel guests, whose bare accounts may carry no plan/role grants but who
-- are assigned to the matters they collaborate on.
insert into features (key, name, description, domain, default_baseline) values
  ('team.messaging', 'Team messaging',
   'Direct messages, group chats and matter discussions with colleagues.',
   'baseline', true)
on conflict (key) do nothing;
