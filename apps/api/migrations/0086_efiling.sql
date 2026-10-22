-- ---- eFiling: filing particulars, filing lifecycle, tracking runs ----------
--
-- Closes the gap between LexDraft and the National eFiling 3.0 portal
-- (filing.ecourts.gov.in) - see docs/efiling-selector-capture-todo.md.
--
-- 1. FILING PARTICULARS. The portal's New Case wizard needs data LexDraft
--    never stored: party gender/age/parentage/contact, organisation and
--    legal-heir parties, dated facts, cause of action, prayer, valuation,
--    the hide-party flag, MACT details and vernacular text. These live in
--    their own tables, NOT on case_parties / case_acts: the eCourts sync
--    replaces those wholesale (delete + reinsert), which would wipe anything
--    the advocate typed in. Particulars describe the case as FILED; eCourts
--    rows describe it as REGISTERED.
--
-- 2. FILING LIFECYCLE. `efiling_filings` is one submission to the portal
--    (new case, IA, caveat, extra documents, deficit court fee) with an
--    explicit status, a checklist of the steps only the advocate can do on
--    the portal (vakalat, Aadhaar eSign, oath video, payment, final submit),
--    court-fee GRNs, scrutiny objections and an event history.
--
-- 3. CONNECTING TO eCOURTS. A submitted new-case filing has no CNR until the
--    court registers it. The 09:00 / 19:00 IST tracker (efiling-tracker.
--    service.ts) looks it up on eCourts by court filing number or party
--    name, and once found hands the CNR to the existing eCourts link/sync
--    (migration 0085). `efiling_tracking_runs` mirrors ecourts_sync_runs so
--    the tracker survives eCourts being down the same way the sync does.

-- ---- 1. Filing particulars ---------------------------------------------

create table if not exists case_filing_particulars (
  case_id               uuid primary key references cases(id) on delete cascade,
  firm_id               uuid not null references firms(id) on delete cascade,
  -- Initial Inputs tab. Codes are eCourts CIS codes (same numbering the
  -- portal's #selState uses); case type is kept as code AND name because the
  -- portal's own case-type master is not yet confirmed to match eCourts'.
  court_tier            text check (court_tier is null or court_tier in ('DC', 'HC')),
  state_code            int,
  district_code         int,
  court_code            int,
  est_code              text,
  -- Court complex the court sits in; only needed to re-render the picker.
  court_complex_code    text,
  establishment_name    text,
  case_type_code        text,
  case_type_name        text,
  is_urgent             boolean not null default false,
  -- High Court Initial Inputs: Civil/Criminal side, matter type, bench.
  hc_side               text check (hc_side is null or hc_side in ('civil', 'criminal')),
  hc_matter_type        text,
  hc_bench              text,
  -- Case Details tab.
  cause_of_action       text,
  cause_of_action_date  date,
  dispute_place         text,
  subject               text,
  prayer                text,
  relief_particulars    text,
  valuation_inr         numeric(16, 2),
  claim_amount_inr      numeric(16, 2),
  -- [{ "act": "Negotiable Instruments Act, 1881", "section": "138" }, ...]
  acts                  jsonb not null default '[]'::jsonb,
  -- POCSO / matrimonial / victim-identity protection.
  hide_party            boolean not null default false,
  hide_party_reason     text,
  -- Vernacular text for the portal's "local language" fields.
  local_language        text,
  plaint_local          text,
  -- MVC tab (motor accident claims). Validated by zod in the service.
  mact                  jsonb,
  updated_by_user_id    uuid references users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists case_filing_particulars_firm_idx on case_filing_particulars (firm_id);

create table if not exists case_filing_parties (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references cases(id) on delete cascade,
  firm_id           uuid not null references firms(id) on delete cascade,
  side              text not null check (side in ('petitioner', 'respondent')),
  position          int not null default 0,
  -- The party this advocate appears for (portal "Party (client) Details").
  is_client         boolean not null default false,
  is_organization   boolean not null default false,
  name              text not null,
  -- Parentage, as the portal asks it: S/o, D/o, W/o, C/o + the name.
  relation_type     text check (relation_type is null or relation_type in ('S/o', 'D/o', 'W/o', 'C/o')),
  relation_name     text,
  gender            text check (gender is null or gender in ('M', 'F', 'T')),
  age               int check (age is null or (age >= 0 and age <= 150)),
  date_of_birth     date,
  occupation        text,
  address           text,
  district          text,
  state             text,
  pin_code          text,
  mobile            text,
  email             text,
  is_minor          boolean not null default false,
  guardian_name     text,
  -- Organisation parties: who represents them.
  org_representative text,
  -- Legal heir of another party on this case (portal "Legal Heir" tab).
  legal_heir_of     uuid references case_filing_parties(id) on delete cascade,
  name_local        text,
  address_local     text,
  -- Passport / PAN / fax / alternate address ("Other Information").
  extra             jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists case_filing_parties_case_idx on case_filing_parties (case_id, side, position);

create table if not exists case_facts (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references cases(id) on delete cascade,
  firm_id      uuid not null references firms(id) on delete cascade,
  position     int not null default 0,
  fact_date    date,
  fact_time    time,
  description  text not null,
  created_at   timestamptz not null default now()
);

create index if not exists case_facts_case_idx on case_facts (case_id, position);

-- ---- 2. Filing lifecycle -----------------------------------------------

create table if not exists efiling_filings (
  id                    uuid primary key default gen_random_uuid(),
  firm_id               uuid not null references firms(id) on delete cascade,
  case_id               uuid not null references cases(id) on delete cascade,
  kind                  text not null default 'new_case'
                        check (kind in ('new_case', 'ia', 'caveat', 'misc_document', 'deficit_court_fee')),
  title                 text not null,
  -- draft/ready: prepared in LexDraft. efiled: entered on the portal ("eFile
  -- Case" issued the eFiling number), pleadings/fees in progress there.
  -- submitted: final submit from Draft Pleadings (GRN selected).
  status                text not null default 'draft'
                        check (status in ('draft', 'ready', 'efiled', 'submitted', 'objected', 'refiled',
                                          'accepted', 'registered', 'rejected', 'withdrawn')),
  -- Number the portal gives on "eFile Case" (temporary on Initial Inputs).
  efiling_no            text,
  efiled_at             timestamptz,
  submitted_at          timestamptz,
  -- CIS filing number, once the court accepts (SMS to the advocate).
  court_filing_no       text,
  court_filing_year     int,
  -- Registration (case number) once the court registers it.
  registration_no       text,
  cnr                   text,
  registered_at         timestamptz,
  objections            text,
  objections_raised_at  timestamptz,
  objections_cured_at   timestamptz,
  -- Advocate-only portal steps: { "vakalat": "done", "esign": "pending", ... }
  steps                 jsonb not null default '{}'::jsonb,
  -- Filing bundle (merged PDF with index + bookmarks).
  bundle_key            text,
  bundle_pages          int,
  bundle_size_bytes     bigint,
  bundle_built_at       timestamptz,
  -- eCourts registration tracking (see efiling-tracker.service.ts).
  tracking_status       text not null default 'idle'
                        check (tracking_status in ('idle', 'searching', 'matched', 'ambiguous', 'not_found', 'error')),
  tracking_candidates   jsonb,
  tracking_last_attempt_at timestamptz,
  tracking_last_error   text,
  tracking_fail_count   int not null default 0,
  created_by_user_id    uuid references users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists efiling_filings_case_idx on efiling_filings (case_id, created_at desc);
create index if not exists efiling_filings_tracking_idx
  on efiling_filings (status)
  where status in ('efiled', 'submitted', 'objected', 'refiled', 'accepted');
create unique index if not exists efiling_filings_efiling_no_uniq
  on efiling_filings (firm_id, upper(efiling_no))
  where efiling_no is not null;

create table if not exists efiling_filing_events (
  id             uuid primary key default gen_random_uuid(),
  filing_id      uuid not null references efiling_filings(id) on delete cascade,
  firm_id        uuid not null references firms(id) on delete cascade,
  from_status    text,
  to_status      text,
  note           text,
  source         text not null default 'advocate' check (source in ('advocate', 'tracker')),
  actor_user_id  uuid references users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists efiling_filing_events_filing_idx on efiling_filing_events (filing_id, created_at);

-- Documents going into the filing, in bundle order.
create table if not exists efiling_documents (
  id            uuid primary key default gen_random_uuid(),
  filing_id     uuid not null references efiling_filings(id) on delete cascade,
  firm_id       uuid not null references firms(id) on delete cascade,
  position      int not null default 0,
  label         text not null,
  source_kind   text not null check (source_kind in ('draft_render', 'document')),
  source_id     uuid not null,
  page_count    int,
  size_bytes    bigint,
  created_at    timestamptz not null default now()
);

create index if not exists efiling_documents_filing_idx on efiling_documents (filing_id, position);

-- Court fee and other payments made on ePay. The payment itself happens on
-- pay.ecourts.gov.in; LexDraft records the GRN so it can be matched at
-- scrutiny and shown on the filing.
create table if not exists efiling_payments (
  id            uuid primary key default gen_random_uuid(),
  filing_id     uuid not null references efiling_filings(id) on delete cascade,
  firm_id       uuid not null references firms(id) on delete cascade,
  purpose       text not null default 'court_fee'
                check (purpose in ('court_fee', 'deficit_court_fee', 'process_fee', 'judicial_deposit', 'other')),
  amount_inr    numeric(16, 2) not null check (amount_inr >= 0),
  grn           text,
  paid_on       date,
  payer_name    text,
  mode          text check (mode is null or mode in ('epay', 'wallet', 'challan')),
  created_by_user_id uuid references users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists efiling_payments_filing_idx on efiling_payments (filing_id);

-- ---- 3. Tracking runs --------------------------------------------------

create table if not exists efiling_tracking_runs (
  id           uuid primary key default gen_random_uuid(),
  slot         text not null check (slot in ('morning', 'evening', 'manual')),
  run_date     date not null,
  attempt      int  not null default 1,
  status       text not null default 'running'
               check (status in ('running', 'completed', 'partial', 'upstream_down', 'failed')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  scanned      int not null default 0,
  matched      int not null default 0,
  ambiguous    int not null default 0,
  not_found    int not null default 0,
  failed       int not null default 0,
  deferred     int not null default 0
);

create index if not exists efiling_tracking_runs_recent_idx
  on efiling_tracking_runs (run_date desc, slot, attempt desc);

-- ---- 4. Advocate enrolment + practice locations ------------------------
-- The portal registers advocates by Bar Council enrolment number and lets
-- them file only in their practice locations.

alter table users
  add column if not exists bar_enrolment_no       text,
  add column if not exists bar_council_state_code int,
  add column if not exists efiling_unique_code    text;

create table if not exists advocate_practice_locations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  firm_id        uuid not null references firms(id) on delete cascade,
  court_tier     text not null check (court_tier in ('DC', 'HC')),
  state_code     int not null,
  district_code  int,
  -- High Court bench name (e.g. "Principal Bench", "Madurai Bench").
  bench          text,
  label          text,
  created_at     timestamptz not null default now()
);

create unique index if not exists advocate_practice_locations_uniq
  on advocate_practice_locations (user_id, court_tier, state_code, coalesce(district_code, 0), coalesce(bench, ''));
