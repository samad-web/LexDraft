-- =============================================================================
-- 0050_title_reports.sql
-- =============================================================================
-- Title Investigation Reports (TIR) — advocate-prepared certification of
-- marketability of title to immovable property, addressed to a bank / NBFC /
-- buyer. Highest-stakes drafting deliverable in property practice; banks
-- refuse to disburse without one.
--
-- Tables:
--   title_reports                       header + state machine + opinion
--   title_report_properties             one row per report (schedule + jurisdiction-specific extras in jsonb)
--   title_report_chain_links            chain of title — typically 30 years, ordered by sequence_no
--   title_report_documents              documents examined (sale deed, EC, patta, etc.) + extraction state
--   title_report_encumbrances           EC transaction rows (subsisting / discharged)
--   title_report_searches               SRO / revenue / municipal / litigation search log
--   title_report_litigation             litigation hits with relevance + stage
--   title_report_statutory_approvals    RERA / building plan / OC / CC / NOCs etc.
--   title_report_heirs                  family tree for inheritance-based links (jurisdiction-aware)
--   title_report_defects                AI- or advocate-flagged issues, ack/dismiss workflow
--   title_report_ai_runs                replay log for every Claude / xAI call (defects + opinion)
--   title_report_exports                PDF/DOCX generation history
--   title_report_counters               firm-year sequential numbering ("TR/2026/00041")
--   plan_title_report_caps              Solo quota: 2 reports / billing cycle
--
-- Tenant isolation: firm_id on every tenant-scoped table, enforced in service
-- code via WHERE clauses (matches every other feature in this app — no RLS).
--
-- RBAC: single feature key `title_report.use`. Per-action role gating
-- (paralegal = draft only, senior associate cannot issue, etc.) lives in
-- the service, not in additional feature keys, to avoid feature-key explosion.
--
-- Idempotent.
-- =============================================================================

-- ---- enums -----------------------------------------------------------------

do $$ begin
  create type title_report_status as enum (
    'draft', 'in_review', 'finalised', 'issued', 'withdrawn'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_applicant_type as enum ('buyer', 'owner', 'borrower');
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_opinion_verdict as enum (
    'pending', 'clear', 'clear_with_conditions', 'not_clear'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_chain_link_type as enum (
    'sale', 'gift', 'partition', 'settlement', 'will', 'inheritance',
    'decree', 'lease', 'mortgage_release', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_extent_unit as enum (
    'sqft', 'sqm', 'acres', 'cents', 'guntas', 'hectares'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_document_type as enum (
    'sale_deed', 'gift_deed', 'partition_deed', 'will',
    'patta', 'chitta', 'adangal', 'khata', 'rtc', 'seven_twelve',
    'ec', 'mutation', 'dc_conversion',
    'building_plan', 'oc', 'cc', 'noc', 'rera',
    'property_tax_receipt', 'death_certificate', 'legal_heir_certificate',
    'family_tree_affidavit', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_copy_type as enum (
    'original', 'certified', 'photocopy', 'notarised_copy'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_extraction_status as enum (
    'none', 'pending', 'done', 'failed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_ec_form as enum ('form_15', 'form_16');
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_encumbrance_status as enum ('subsisting', 'discharged');
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_search_type as enum (
    'sro', 'revenue', 'municipal',
    'litigation_hc', 'litigation_dc', 'litigation_drt', 'litigation_nclt',
    'gst', 'ibbi', 'mca', 'attachment', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_litigation_relevance as enum ('direct', 'indirect', 'none');
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_approval_type as enum (
    'rera', 'building_plan', 'layout', 'oc', 'cc',
    'fire_noc', 'pollution_noc', 'aai_noc', 'environment',
    'dc_conversion', 'khata_transfer', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_approval_status as enum (
    'valid', 'expired', 'not_obtained', 'not_applicable'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_personal_law as enum (
    'hindu', 'muslim', 'christian', 'parsi', 'special_marriage', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_consent_status as enum (
    'obtained', 'pending', 'not_required'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_defect_category as enum (
    'chain_gap', 'unregistered_link', 'stamp_duty', 'extent_mismatch',
    'subsisting_encumbrance', 'pending_litigation', 'missing_noc',
    'approval_lapsed', 'inheritance_gap', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_defect_severity as enum ('info', 'warning', 'blocker');
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_defect_source as enum ('ai', 'advocate', 'imported');
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_ai_run_type as enum (
    'defects_analysis', 'opinion_synthesis'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_report_export_format as enum ('pdf', 'docx');
exception when duplicate_object then null; end $$;

-- ---- title_reports (header) -----------------------------------------------
-- One row per investigation. Header columns hold the cover-page essentials
-- (applicant + bank + search window) and the final marketability opinion
-- once synthesised. `report_number` is firm-year-scoped ("TR/2026/00041") and
-- assigned at create time via title_report_counters.

create table if not exists title_reports (
  id                  uuid primary key default gen_random_uuid(),
  firm_id             uuid not null references firms(id) on delete cascade,

  -- Optional links into the rest of the practice. A title report may be
  -- standalone (advocate engaged directly by a bank) or attached to a
  -- matter/client.
  case_id             uuid references cases(id) on delete set null,
  client_id           uuid references clients(id) on delete set null,

  created_by          uuid not null references users(id) on delete restrict,
  assigned_to         uuid references users(id) on delete set null,

  status              title_report_status not null default 'draft',

  -- Firm-year sequence — unique per firm.
  report_number       text not null,

  -- Jurisdiction drives the revenue-records vocabulary (Patta/Chitta vs
  -- Khata/RTC vs 7/12) the wizard surfaces. Two-letter India state code
  -- ("TN", "KA", "MH", "TG", "AP", "DL", "UP", …) or "OTHER".
  jurisdiction_state  text not null,

  applicant_name      text not null,
  applicant_type      title_report_applicant_type not null default 'buyer',
  bank_name           text,
  bank_branch         text,
  loan_reference      text,

  -- Search window — typically 30 years back from now for marketable title.
  search_period_from  date,
  search_period_to    date,

  -- Marketability opinion. Verdict starts 'pending'; opinion_summary is the
  -- short headline rendered on the cover page (full reasoning lives in the
  -- latest opinion_synthesis ai_run).
  opinion_verdict     title_report_opinion_verdict not null default 'pending',
  opinion_summary     text,

  finalised_at        timestamptz,
  issued_at           timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint title_reports_report_number_per_firm unique (firm_id, report_number)
);

create index if not exists title_reports_firm_status_idx
  on title_reports (firm_id, status, created_at desc);
create index if not exists title_reports_firm_assigned_idx
  on title_reports (firm_id, assigned_to) where assigned_to is not null;
create index if not exists title_reports_firm_jurisdiction_idx
  on title_reports (firm_id, jurisdiction_state);
create index if not exists title_reports_case_idx
  on title_reports (case_id) where case_id is not null;

do $$ begin
  create trigger trg_title_reports_updated
    before update on title_reports
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- title_report_properties ----------------------------------------------
-- Schedule of property — one row per report. Boundaries (N/S/E/W) are
-- mandatory under Indian conveyancing practice. Jurisdiction-specific
-- revenue fields (patta no, chitta, RTC, 7/12 …) live in jurisdiction_specific
-- jsonb keyed by field so the schema doesn't need a column per state.

create table if not exists title_report_properties (
  id                       uuid primary key default gen_random_uuid(),
  title_report_id          uuid not null unique
                             references title_reports(id) on delete cascade,
  firm_id                  uuid not null references firms(id) on delete cascade,

  address                  text not null,
  survey_no                text,
  sub_division             text,
  extent_value             numeric(14,4),
  extent_unit              title_report_extent_unit,
  boundary_north           text,
  boundary_south           text,
  boundary_east            text,
  boundary_west            text,

  -- Schedule A — the full legal description as it will appear in the report.
  schedule_a               text,

  latitude                 numeric(10,7),
  longitude                numeric(10,7),

  -- Jurisdiction-specific revenue/municipal record references. Keys vary by
  -- state — Tamil Nadu: patta_no, chitta_no, adangal, a_register, fmb;
  -- Karnataka: khata_no, rtc_no, mutation_no, tippani, akarbandh;
  -- Maharashtra: seven_twelve, eight_a, mutation_entries; etc. The wizard's
  -- JurisdictionFields component drives which keys are surfaced.
  jurisdiction_specific    jsonb not null default '{}'::jsonb,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists title_report_properties_firm_idx
  on title_report_properties (firm_id);

do $$ begin
  create trigger trg_title_report_properties_updated
    before update on title_report_properties
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- title_report_chain_links ---------------------------------------------
-- Ordered chain of title — typically 30 years for marketable title under
-- Indian conveyancing practice. Ordered by sequence_no; the wizard's
-- timeline visualisation computes gaps (years between consecutive links).

create table if not exists title_report_chain_links (
  id                   uuid primary key default gen_random_uuid(),
  title_report_id      uuid not null references title_reports(id) on delete cascade,
  firm_id              uuid not null references firms(id) on delete cascade,

  sequence_no          integer not null,
  link_type            title_report_chain_link_type not null,

  transferor           text not null,
  transferee           text not null,
  document_date        date,

  -- Registration trail. SRO = Sub-Registrar Office; book / volume / pages
  -- locate the document in the SRO register.
  document_no          text,
  sro_office           text,
  book_no              text,
  volume_no            text,
  pages                text,

  stamp_duty_paid      numeric(14,2),
  consideration        numeric(16,2),
  notes                text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint title_report_chain_links_seq_unique unique (title_report_id, sequence_no)
);

create index if not exists title_report_chain_links_report_idx
  on title_report_chain_links (title_report_id, sequence_no);
create index if not exists title_report_chain_links_firm_idx
  on title_report_chain_links (firm_id);

do $$ begin
  create trigger trg_title_report_chain_links_updated
    before update on title_report_chain_links
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- title_report_documents -----------------------------------------------
-- Each document the advocate examined. storage_ref points into the shared
-- storage service (same key shape as documents.storage_key). Extraction
-- pipeline writes extracted_payload (typed by document_type) and updates
-- extraction_status; the wizard surfaces extracted values as accept/reject
-- suggestions — never overwrites user-entered fields.

create table if not exists title_report_documents (
  id                   uuid primary key default gen_random_uuid(),
  title_report_id      uuid not null references title_reports(id) on delete cascade,
  firm_id              uuid not null references firms(id) on delete cascade,

  document_type        title_report_document_type not null,
  document_label       text not null,
  parties              text,
  document_date        date,
  registration_no      text,
  sro_office           text,
  copy_type            title_report_copy_type,

  -- Blob in storage. Null when the document was logged but no scan was
  -- uploaded (e.g. an SRO register entry the advocate inspected in person).
  storage_ref          text,
  file_name            text,
  file_mime            text,
  file_size            integer,

  extracted_payload    jsonb not null default '{}'::jsonb,
  extraction_status    title_report_extraction_status not null default 'none',
  extraction_error     text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists title_report_documents_report_idx
  on title_report_documents (title_report_id);
create index if not exists title_report_documents_firm_idx
  on title_report_documents (firm_id);
create index if not exists title_report_documents_extraction_idx
  on title_report_documents (extraction_status)
  where extraction_status in ('pending', 'failed');

do $$ begin
  create trigger trg_title_report_documents_updated
    before update on title_report_documents
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- title_report_encumbrances --------------------------------------------
-- Transactions read off the Encumbrance Certificate (Form 15 / Form 16).
-- Subsisting rows that have no discharge_doc_ref are flagged as defects of
-- category 'subsisting_encumbrance' by the AI analysis pass.

create table if not exists title_report_encumbrances (
  id                   uuid primary key default gen_random_uuid(),
  title_report_id      uuid not null references title_reports(id) on delete cascade,
  firm_id              uuid not null references firms(id) on delete cascade,

  ec_period_from       date,
  ec_period_to         date,
  ec_office            text,
  ec_form              title_report_ec_form,

  transaction_no       text,
  transaction_date     date,
  transaction_type     text,
  parties              text,
  consideration        numeric(16,2),

  status               title_report_encumbrance_status not null default 'subsisting',
  discharge_doc_ref    text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists title_report_encumbrances_report_idx
  on title_report_encumbrances (title_report_id);
create index if not exists title_report_encumbrances_firm_idx
  on title_report_encumbrances (firm_id);
create index if not exists title_report_encumbrances_subsisting_idx
  on title_report_encumbrances (title_report_id)
  where status = 'subsisting';

do $$ begin
  create trigger trg_title_report_encumbrances_updated
    before update on title_report_encumbrances
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- title_report_searches ------------------------------------------------
-- Log of every search the advocate conducted — SRO, revenue, municipal,
-- court litigation searches, etc. `result_negative = true` means the search
-- returned no hits (the clean outcome for a litigation search).

create table if not exists title_report_searches (
  id                   uuid primary key default gen_random_uuid(),
  title_report_id      uuid not null references title_reports(id) on delete cascade,
  firm_id              uuid not null references firms(id) on delete cascade,

  search_type          title_report_search_type not null,
  search_office        text,
  search_query         text,
  search_date          date,
  result_summary       text,
  result_negative      boolean not null default false,
  attachment_ref       text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists title_report_searches_report_idx
  on title_report_searches (title_report_id);
create index if not exists title_report_searches_firm_idx
  on title_report_searches (firm_id);

do $$ begin
  create trigger trg_title_report_searches_updated
    before update on title_report_searches
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- title_report_litigation ----------------------------------------------
-- Live + pending litigation surfacing from the search-by-name and
-- search-by-property runs. Relevance = direct triggers a lis pendens flag
-- (CPC §52) in the AI defects pass.

create table if not exists title_report_litigation (
  id                   uuid primary key default gen_random_uuid(),
  title_report_id      uuid not null references title_reports(id) on delete cascade,
  firm_id              uuid not null references firms(id) on delete cascade,

  court                text,
  case_number          text,
  parties              text,
  cause_of_action      text,
  stage                text,
  relevance            title_report_litigation_relevance not null default 'none',
  next_date            date,
  notes                text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists title_report_litigation_report_idx
  on title_report_litigation (title_report_id);
create index if not exists title_report_litigation_firm_idx
  on title_report_litigation (firm_id);

do $$ begin
  create trigger trg_title_report_litigation_updated
    before update on title_report_litigation
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- title_report_statutory_approvals -------------------------------------
-- RERA, building plan / layout / OC / CC approvals, NOCs (fire, pollution,
-- AAI height clearance, environment), DC conversion. validity is text so it
-- can carry "perpetual" / "until further notice" forms.

create table if not exists title_report_statutory_approvals (
  id                   uuid primary key default gen_random_uuid(),
  title_report_id      uuid not null references title_reports(id) on delete cascade,
  firm_id              uuid not null references firms(id) on delete cascade,

  approval_type        title_report_approval_type not null,
  authority            text,
  reference_no         text,
  issue_date           date,
  validity             text,
  status               title_report_approval_status not null default 'valid',

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists title_report_statutory_approvals_report_idx
  on title_report_statutory_approvals (title_report_id);
create index if not exists title_report_statutory_approvals_firm_idx
  on title_report_statutory_approvals (firm_id);

do $$ begin
  create trigger trg_title_report_statutory_approvals_updated
    before update on title_report_statutory_approvals
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- title_report_heirs ---------------------------------------------------
-- Family tree for any chain link where transfer is by inheritance / intestate
-- succession. Heirs are listed per applicable personal law (Hindu Succession
-- Act, Muslim personal law, Indian Succession Act, etc.). consent_status
-- tracks whether each heir has joined the deed or given a no-objection.

create table if not exists title_report_heirs (
  id                   uuid primary key default gen_random_uuid(),
  title_report_id      uuid not null references title_reports(id) on delete cascade,
  firm_id              uuid not null references firms(id) on delete cascade,

  predecessor_name     text not null,
  predecessor_dod      date,
  personal_law         title_report_personal_law not null default 'hindu',

  heir_name            text not null,
  relationship         text,
  share                text,
  consent_status       title_report_consent_status not null default 'pending',

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists title_report_heirs_report_idx
  on title_report_heirs (title_report_id);
create index if not exists title_report_heirs_firm_idx
  on title_report_heirs (firm_id);

do $$ begin
  create trigger trg_title_report_heirs_updated
    before update on title_report_heirs
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- title_report_defects -------------------------------------------------
-- AI-flagged + advocate-added defects. The ack workflow lets an advocate
-- accept (the defect stays as a known limitation in the opinion) or dismiss
-- (the defect is suppressed from the report PDF) each item. Finalisation
-- gate: every severity='blocker' defect must be acknowledged or dismissed.

create table if not exists title_report_defects (
  id                   uuid primary key default gen_random_uuid(),
  title_report_id      uuid not null references title_reports(id) on delete cascade,
  firm_id              uuid not null references firms(id) on delete cascade,

  category             title_report_defect_category not null,
  severity             title_report_defect_severity not null default 'warning',
  description          text not null,
  recommendation       text,
  source               title_report_defect_source not null default 'ai',

  -- Optional refs into the underlying rows the defect points to. Stored as
  -- jsonb (not FKs) because the references can span multiple table types
  -- (chain_link, document, encumbrance, litigation, approval, heir) and the
  -- AI prompt emits them as a typed array.
  refs                 jsonb not null default '[]'::jsonb,

  acknowledged_by      uuid references users(id) on delete set null,
  acknowledged_at      timestamptz,
  dismissed            boolean not null default false,
  dismissed_reason     text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists title_report_defects_report_idx
  on title_report_defects (title_report_id, severity);
create index if not exists title_report_defects_firm_idx
  on title_report_defects (firm_id);
create index if not exists title_report_defects_blockers_idx
  on title_report_defects (title_report_id)
  where severity = 'blocker' and dismissed = false and acknowledged_at is null;

do $$ begin
  create trigger trg_title_report_defects_updated
    before update on title_report_defects
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- title_report_ai_runs -------------------------------------------------
-- Replay log for every Claude / xAI call. `input_hash` is sha256 over the
-- normalised tree we sent in; lets the UI dedupe runs and lets a future
-- baseline-replay job re-score outputs without re-paying for the call.

create table if not exists title_report_ai_runs (
  id                   uuid primary key default gen_random_uuid(),
  title_report_id      uuid not null references title_reports(id) on delete cascade,
  firm_id              uuid not null references firms(id) on delete cascade,

  run_type             title_report_ai_run_type not null,
  model                text,
  provider             text,
  input_hash           text,
  output               jsonb not null default '{}'::jsonb,
  status               text not null default 'pending'
                         check (status in ('pending', 'running', 'done', 'failed')),
  error                text,

  tokens_in            integer,
  tokens_out           integer,
  duration_ms          integer,

  created_by           uuid references users(id) on delete set null,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz
);

create index if not exists title_report_ai_runs_report_idx
  on title_report_ai_runs (title_report_id, created_at desc);
create index if not exists title_report_ai_runs_firm_idx
  on title_report_ai_runs (firm_id);
create index if not exists title_report_ai_runs_pending_idx
  on title_report_ai_runs (status, created_at)
  where status in ('pending', 'running');

-- ---- title_report_exports -------------------------------------------------
-- Generated PDFs / DOCX. storage_ref points at the blob. letterhead_id
-- carries the letterhead used at generation time so a later letterhead
-- change doesn't retro-mutate an issued report's branding.

create table if not exists title_report_exports (
  id                   uuid primary key default gen_random_uuid(),
  title_report_id      uuid not null references title_reports(id) on delete cascade,
  firm_id              uuid not null references firms(id) on delete cascade,

  format               title_report_export_format not null default 'pdf',
  letterhead_id        uuid,
  storage_ref          text,
  file_name            text,
  file_mime            text,
  file_size            integer,

  created_by           uuid references users(id) on delete set null,
  created_at           timestamptz not null default now()
);

create index if not exists title_report_exports_report_idx
  on title_report_exports (title_report_id, created_at desc);
create index if not exists title_report_exports_firm_idx
  on title_report_exports (firm_id);

-- ---- title_report_counters ------------------------------------------------
-- Atomically allocate the next firm-year sequence for report_number.
-- A short transaction in the service does:
--   insert into title_report_counters (firm_id, year, last_seq) values (..., 1)
--   on conflict (firm_id, year)
--   do update set last_seq = title_report_counters.last_seq + 1
--   returning last_seq;
-- which is race-safe under read-committed.

create table if not exists title_report_counters (
  firm_id     uuid not null references firms(id) on delete cascade,
  year        integer not null,
  last_seq    integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (firm_id, year)
);

-- ---- plan_title_report_caps -----------------------------------------------
-- Per-plan monthly cap on title-report creations. Mirrors plan_ai_caps
-- (migration 0045). Solo = 2 reports per billing cycle; Practice / Firm are
-- effectively unmetered (large numbers). Set by migration only — no admin
-- route mutates this table.

create table if not exists plan_title_report_caps (
  plan_tier    firm_plan_tier primary key,
  monthly_cap  integer not null check (monthly_cap >= 0),
  updated_at   timestamptz not null default now()
);

insert into plan_title_report_caps (plan_tier, monthly_cap) values
  ('Solo',     2),
  ('Practice', 200),
  ('Firm',     1000)
on conflict (plan_tier) do nothing;

-- ---- RBAC -----------------------------------------------------------------

insert into features (key, name, description, domain, default_baseline) values
  ('title_report.use',
   'Title Reports',
   'Prepare Indian title investigation reports (TIR) with AI defect analysis and marketability opinion synthesis.',
   'drafting',
   false)
on conflict (key) do nothing;

-- All three plan tiers see the feature. Solo is capped by
-- plan_title_report_caps; the cap layer is not a feature gate.
insert into plan_features (plan_tier, feature_key, enabled)
select t::firm_plan_tier, 'title_report.use', true
from unnest(array['Solo','Practice','Firm']) as t
on conflict (plan_tier, feature_key) do nothing;

-- Every system role that already has drafting.basic gets title_report.use.
-- Per-action gating (paralegal cannot finalise, senior associate cannot
-- issue, etc.) is enforced in title-reports.service against the user's
-- role text — not via additional feature keys, to avoid feature-key
-- explosion as the action matrix grows.
insert into role_features (role_id, feature_key, enabled)
select rf.role_id, 'title_report.use', true
from role_features rf
where rf.feature_key = 'drafting.basic' and rf.enabled = true
on conflict (role_id, feature_key) do nothing;
