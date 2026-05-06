-- =============================================================================
-- LexDraft — extra domain tables
-- =============================================================================
-- Adds tables for clients, leads, invoices, expenses, limitations, and diary
-- entries — the resources that power Clients, Leads, Invoices, Expenses,
-- Limitation, Diary, Calendar, CauseList, Archive, and Analytics views.
-- Also extends `cases` with an outcome + closed_at so Archive can filter.
-- Idempotent.
-- =============================================================================

-- ---- enums ------------------------------------------------------------------
do $$ begin
  create type client_type   as enum ('Individual', 'Corporate', 'Govt');
exception when duplicate_object then null; end $$;

do $$ begin
  create type client_status as enum ('active', 'inactive', 'prospect');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lead_stage as enum ('new', 'qualified', 'proposal', 'won', 'lost');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_status as enum ('paid', 'pending', 'overdue');
exception when duplicate_object then null; end $$;

do $$ begin
  create type expense_status as enum ('pending', 'approved', 'billed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type diary_kind as enum ('hearing', 'judgment', 'filing');
exception when duplicate_object then null; end $$;

do $$ begin
  create type case_outcome as enum ('Won', 'Lost', 'Settled', 'Withdrawn');
exception when duplicate_object then null; end $$;

-- ---- cases additions --------------------------------------------------------
alter table cases add column if not exists outcome   case_outcome;
alter table cases add column if not exists closed_at date;

-- ---- hearings additions -----------------------------------------------------
alter table hearings add column if not exists hearing_date date;
alter table hearings add column if not exists judge       text;
create index if not exists hearings_date_idx on hearings (hearing_date);

-- ---- clients ----------------------------------------------------------------
create table if not exists clients (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid references firms(id) on delete cascade,
  name            text not null,
  type            client_type not null default 'Individual',
  status          client_status not null default 'active',
  last_contact    date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists clients_firm_idx on clients (firm_id);

do $$ begin
  create trigger trg_clients_updated before update on clients for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- leads ------------------------------------------------------------------
create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid references firms(id) on delete cascade,
  name            text not null,
  value_inr       integer not null default 0,
  referrer        text not null default '',
  stage           lead_stage not null default 'new',
  captured_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists leads_firm_stage_idx on leads (firm_id, stage);

do $$ begin
  create trigger trg_leads_updated before update on leads for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- invoices ---------------------------------------------------------------
create table if not exists invoices (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid references firms(id) on delete cascade,
  invoice_no      text not null,
  client          text not null,
  amount_inr      integer not null default 0,
  issued_date     date not null,
  due_date        date not null,
  status          invoice_status not null default 'pending',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists invoices_firm_idx on invoices (firm_id);
create unique index if not exists invoices_firm_no_idx on invoices (firm_id, invoice_no);

do $$ begin
  create trigger trg_invoices_updated before update on invoices for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- expenses ---------------------------------------------------------------
create table if not exists expenses (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid references firms(id) on delete cascade,
  expense_no      text not null,
  expense_date    date not null,
  description     text not null,
  category        text not null,
  case_label      text not null default '',
  amount_inr      integer not null default 0,
  status          expense_status not null default 'pending',
  reimbursable    boolean not null default false,
  billable        boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists expenses_firm_idx on expenses (firm_id);
create unique index if not exists expenses_firm_no_idx on expenses (firm_id, expense_no);

do $$ begin
  create trigger trg_expenses_updated before update on expenses for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- limitations ------------------------------------------------------------
create table if not exists limitations (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid references firms(id) on delete cascade,
  case_label      text not null,
  cnr             text not null default '',
  filing_type     text not null,
  forum           text not null default '',
  deadline        date not null,
  filed_by        text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists limitations_firm_idx on limitations (firm_id);
create index if not exists limitations_deadline_idx on limitations (deadline);

do $$ begin
  create trigger trg_limitations_updated before update on limitations for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- diary entries ----------------------------------------------------------
create table if not exists diary_entries (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid references firms(id) on delete cascade,
  entry_date      date not null,
  entry_time      text not null default '',          -- HH:mm
  kind            diary_kind not null,
  case_label      text not null,
  cnr             text not null default '',
  detail          text not null default '',
  forum           text not null default '',
  created_at      timestamptz not null default now()
);
create index if not exists diary_entries_firm_date_idx on diary_entries (firm_id, entry_date);
