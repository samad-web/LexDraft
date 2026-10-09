-- =============================================================================
-- 0073_co_counsel_handover.sql
-- =============================================================================
-- Cross-firm case handover ("Co-Counsel"): an advocate who cannot attend a
-- matter hands the whole case to an advocate outside their firm - who may not
-- have a LexDraft account yet. Same-firm handover already works today via
-- `assignments.service.ts::setCaseLead` (case_assignments, migration 0049);
-- this migration adds the cross-firm path on top, without touching that.
--
-- Two new tables:
--   handover_requests  - the workflow/audit record (who asked, who was asked,
--                         how it was resolved). One row per handover attempt.
--   case_guest_grants  - the actual access-control row. Kept separate from
--                         handover_requests so revocation/expiry never has to
--                         parse workflow state, and so a grant's lifetime can
--                         outlive or be renewed independent of the request
--                         that created it.
--
-- invitations gains `kind`/`case_id`/`phone`/`invited_name` instead of a
-- parallel invite table, reusing the existing token/TTL/accept machinery
-- (apps/api/src/services/invitations.service.ts) for the "brand-new person"
-- path. Existing firm-member invites are unaffected (kind defaults to the
-- prior implicit behaviour).
--
-- Idempotent.
-- =============================================================================

alter table invitations add column if not exists kind text not null default 'firm_member'
  check (kind in ('firm_member', 'co_counsel_handover'));
alter table invitations add column if not exists case_id uuid references cases(id) on delete cascade;
alter table invitations add column if not exists phone text;
alter table invitations add column if not exists invited_name text;
create index if not exists invitations_case_idx on invitations (case_id) where case_id is not null;

do $$ begin
  create type handover_target_kind as enum ('in_firm_user', 'existing_external_user', 'new_external_invite');
exception when duplicate_object then null; end $$;

do $$ begin
  create type handover_status as enum ('pending', 'accepted', 'declined', 'cancelled', 'expired');
exception when duplicate_object then null; end $$;

create table if not exists handover_requests (
  id                  uuid primary key default gen_random_uuid(),
  case_id             uuid not null references cases(id) on delete cascade,
  source_firm_id      uuid not null references firms(id) on delete cascade,
  requested_by        uuid not null references users(id) on delete cascade,
  target_kind         handover_target_kind not null,
  -- Populated once resolved to a concrete user, for in_firm_user and
  -- existing_external_user; null while a new_external_invite is pending.
  target_user_id      uuid references users(id) on delete set null,
  target_name         text,
  target_email        text,
  target_phone        text,
  invitation_id       text references invitations(id) on delete set null,
  reason              text,
  urgency             text not null default 'normal' check (urgency in ('normal', 'urgent')),
  status              handover_status not null default 'pending',
  -- Revenue-attribution: true when accepting this request created a brand
  -- new LexDraft account (vs. an existing user accepting).
  attributed_signup   boolean not null default false,
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz
);
create index if not exists handover_requests_case_idx on handover_requests (case_id);
create index if not exists handover_requests_firm_status_idx on handover_requests (source_firm_id, status);

-- Cross-firm access grant, scoped to exactly one case. This is the row every
-- case-scoped read path checks (alongside its normal firm_id match) to decide
-- whether an out-of-firm advocate may see a case's hearings/documents/notes.
create table if not exists case_guest_grants (
  id                    uuid primary key default gen_random_uuid(),
  case_id               uuid not null references cases(id) on delete cascade,
  guest_user_id         uuid not null references users(id) on delete cascade,
  granting_firm_id      uuid not null references firms(id) on delete cascade,
  handover_request_id   uuid references handover_requests(id) on delete set null,
  status                text not null default 'active' check (status in ('active', 'revoked')),
  created_at            timestamptz not null default now(),
  revoked_at            timestamptz,
  unique (case_id, guest_user_id)
);
create index if not exists case_guest_grants_guest_idx on case_guest_grants (guest_user_id) where status = 'active';
create index if not exists case_guest_grants_case_idx on case_guest_grants (case_id) where status = 'active';

-- Revenue attribution on the user itself, for simple funnel reporting before
-- a proper events table exists.
alter table users add column if not exists acquired_via text
  check (acquired_via in ('signup', 'invite', 'co_counsel_handover')) default 'signup';
alter table users add column if not exists acquired_via_handover_id uuid references handover_requests(id) on delete set null;
