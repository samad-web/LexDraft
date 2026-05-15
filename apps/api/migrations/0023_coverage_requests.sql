-- Hearing-coverage swap board (Practice + Firm tier).
--
-- When an advocate has a clash on a hearing date, they post the matter to the
-- board so anyone in the firm can pick it up. The historical workflow was a
-- WhatsApp scramble - this turns it into an auditable, claimable queue with
-- a brief packet attached.
--
-- Multi-tenant: scoped via firm_id (every read/write joins to the caller's
-- firm). Hearing/case FKs are optional + ON DELETE SET NULL because (a) we
-- denormalize the matter snapshot at create time (court, date, time, purpose,
-- case_label) so the card still reads usefully if the linked hearing is later
-- deleted, and (b) hearings without case_id occasionally exist in legacy data.
--
-- Claim race: the service performs `update ... where status='open'` and treats
-- a zero-row update as a 409 ConflictError. The composite (firm_id, status)
-- index keeps the open-board listing fast even after many completed rows.

do $$ begin
  create type coverage_status as enum ('open', 'claimed', 'cancelled', 'completed');
exception when duplicate_object then null; end $$;

create table if not exists coverage_requests (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references firms(id) on delete cascade,
  hearing_id      uuid references hearings(id) on delete set null,
  case_id         uuid references cases(id) on delete set null,
  case_label      text not null,
  court           text not null,
  hearing_date    date not null,
  hearing_time    text not null,
  purpose         text not null,
  brief_url       text,                                   -- optional doc link
  brief_notes     text,
  requested_by    uuid not null references users(id) on delete cascade,
  claimed_by      uuid references users(id) on delete set null,
  status          coverage_status not null default 'open',
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  completed_at    timestamptz
);

create index if not exists coverage_requests_firm_status_idx on coverage_requests (firm_id, status);
create index if not exists coverage_requests_hearing_idx on coverage_requests (hearing_date);
create index if not exists coverage_requests_requested_by_idx on coverage_requests (requested_by);
create index if not exists coverage_requests_claimed_by_idx on coverage_requests (claimed_by);
