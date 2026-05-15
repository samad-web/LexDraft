-- =============================================================================
-- LexDraft - initial schema
-- =============================================================================
-- This migration creates every domain table the API services read/write.
-- It is idempotent: every CREATE uses IF NOT EXISTS and every ALTER is guarded.
-- =============================================================================

-- ---- extensions -------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---- enums ------------------------------------------------------------------
do $$ begin
  create type case_status as enum ('Active', 'Pending', 'Closed', 'Archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_column as enum ('pending', 'progress', 'review', 'done');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_priority as enum ('vermillion', 'amber', 'cobalt', 'sage', 'muted');
exception when duplicate_object then null; end $$;

do $$ begin
  create type alert_tone as enum ('vermillion', 'amber', 'cobalt', 'sage');
exception when duplicate_object then null; end $$;

do $$ begin
  create type hearing_status as enum ('today', 'upcoming', 'past');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invitation_status as enum ('pending', 'accepted', 'cancelled', 'expired');
exception when duplicate_object then null; end $$;

-- ---- firms ------------------------------------------------------------------
create table if not exists firms (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  seats           integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---- users ------------------------------------------------------------------
create table if not exists users (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid references firms(id) on delete set null,
  name            text not null,
  email           text not null,
  role            text not null,
  is_superadmin   boolean not null default false,
  password_hash   text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- Case-insensitive uniqueness on email (Supabase doesn't ship citext by default).
create unique index if not exists users_email_lower_idx on users (lower(email));

-- ---- cases ------------------------------------------------------------------
create table if not exists cases (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid references firms(id) on delete cascade,
  cnr             text not null unique,
  title           text not null,
  court           text not null,
  stage           text not null,
  client          text not null,
  status          case_status not null default 'Active',
  next_hearing    date,
  type            text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists cases_firm_idx on cases (firm_id);
create index if not exists cases_status_idx on cases (status);

-- ---- hearings ---------------------------------------------------------------
create table if not exists hearings (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid references cases(id) on delete cascade,
  case_label      text not null,
  hearing_time    text not null,         -- HH:mm 24h, matches the DTO
  court           text not null,
  purpose         text not null,
  status          hearing_status not null default 'upcoming',
  created_at      timestamptz not null default now()
);
create index if not exists hearings_status_idx on hearings (status);

-- ---- tasks ------------------------------------------------------------------
create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid references firms(id) on delete cascade,
  case_label      text not null,
  title           text not null,
  due_date        date,
  priority        task_priority not null default 'cobalt',
  assignee        text not null,
  comments_count  integer not null default 0,
  column_name     task_column not null default 'pending',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists tasks_column_idx on tasks (column_name);

-- ---- documents --------------------------------------------------------------
create table if not exists documents (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid references firms(id) on delete cascade,
  case_id         uuid references cases(id) on delete set null,
  case_label      text not null,
  name            text not null,
  type            text not null,
  /* Human-readable label, kept for compatibility with the existing DTO. */
  updated_label   text not null default 'just now',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists documents_firm_idx on documents (firm_id);

-- ---- alerts -----------------------------------------------------------------
create table if not exists alerts (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid references firms(id) on delete cascade,
  tone            alert_tone not null,
  text            text not null,
  detail          text not null,
  created_at      timestamptz not null default now()
);
create index if not exists alerts_firm_idx on alerts (firm_id);

-- ---- invitations ------------------------------------------------------------
create table if not exists invitations (
  id              text primary key,
  firm_id         uuid references firms(id) on delete cascade,
  email           text not null,
  role            text not null,
  firm_name       text not null,
  invited_by_id   uuid,
  invited_by_name text not null,
  status          invitation_status not null default 'pending',
  token           text not null unique,
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  message         text,
  created_at      timestamptz not null default now()
);
create index if not exists invitations_status_idx on invitations (status);
create index if not exists invitations_email_idx on invitations (lower(email));

-- ---- updated_at triggers ----------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$ begin
  create trigger trg_users_updated      before update on users      for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_firms_updated      before update on firms      for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_cases_updated      before update on cases      for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_tasks_updated      before update on tasks      for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_documents_updated  before update on documents  for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
