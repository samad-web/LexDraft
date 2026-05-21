-- =============================================================================
-- 0035_mock_arguments.sql
-- =============================================================================
-- Mock Arguments — voice/text oral-advocacy practice grounded in real case
-- facts and the indiacode-rag corpus.
--
-- Tables:
--   mock_argument_uploads   - PDF/DOCX uploads used to bootstrap a session.
--                             Mirrors case_notes' upload shape so the same
--                             text-extraction pipeline can be reused.
--   mock_argument_sessions  - one row per practice session. Bound EITHER to
--                             a saved case (case_id) OR an upload (upload_id);
--                             a CHECK enforces exactly-one.
--   mock_argument_turns     - append-only log of user + AI turns.
--   mock_argument_reviews   - end-of-session structured review (rubric scores,
--                             strengths, weaknesses, missed arguments, study
--                             list). One row per session.
--
-- Tenant isolation is enforced in service code via firm_id + user_id WHERE
-- clauses, matching every other feature in this app. No RLS (the codebase
-- doesn't use RLS anywhere — see review.service / case-notes.service).
--
-- RBAC: a single feature key `mock_arguments.use` granted to all plan tiers
-- and to every system role that already has matter.view. Lets a firm admin
-- meter the feature later without inventing a second key.
-- =============================================================================

-- ---- enums -----------------------------------------------------------------

do $$ begin
  create type mock_argument_role as enum (
    'petitioner', 'respondent', 'prosecution', 'defense', 'appellant', 'appellee'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type mock_argument_judge_persona as enum ('neutral', 'strict', 'socratic');
exception when duplicate_object then null; end $$;

do $$ begin
  create type mock_argument_session_status as enum (
    'setup', 'active', 'concluded', 'abandoned'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type mock_argument_input_mode as enum ('voice', 'text');
exception when duplicate_object then null; end $$;

do $$ begin
  create type mock_argument_speaker as enum ('user', 'ai');
exception when duplicate_object then null; end $$;

do $$ begin
  create type mock_argument_upload_status as enum ('pending', 'ok', 'failed');
exception when duplicate_object then null; end $$;

-- ---- uploads ---------------------------------------------------------------
-- Pre-session attachments. A session that's bootstrapped from an uploaded
-- case file refers to this row via mock_argument_sessions.upload_id; the
-- session also caches the distilled summary in matter_summary_jsonb so the
-- prompt builder doesn't have to re-extract.

create table if not exists mock_argument_uploads (
  id                  uuid primary key default gen_random_uuid(),
  firm_id             uuid not null references firms(id) on delete cascade,
  uploader_user_id    uuid not null references users(id) on delete restrict,

  -- Original blob metadata (mirrors case_notes shape so the same presign /
  -- finalize flow could be wired in later — slice 1 uploads directly to the
  -- API endpoint instead of presigning).
  storage_key         text not null,
  file_name           text not null,
  file_mime           text not null,
  file_size           integer not null,

  -- Extraction output. body is the AI-consumable text the session prompt
  -- will use; status records success/failure so the UI can surface it.
  body                text not null default '',
  extraction_status   mock_argument_upload_status not null default 'pending',
  extraction_error    text,

  created_at          timestamptz not null default now()
);

create index if not exists mock_argument_uploads_firm_idx
  on mock_argument_uploads (firm_id);

-- ---- sessions --------------------------------------------------------------

create table if not exists mock_argument_sessions (
  id                       uuid primary key default gen_random_uuid(),
  firm_id                  uuid not null references firms(id) on delete cascade,
  user_id                  uuid not null references users(id) on delete cascade,

  -- Exactly one of (case_id, upload_id) is set. Enforced by CHECK below.
  case_id                  uuid references cases(id) on delete set null,
  upload_id                uuid references mock_argument_uploads(id) on delete set null,

  -- LLM-distilled summary of the matter: parties, facts, issues, applicable
  -- statutes. Confirmed/edited by the user before the session starts.
  -- Pinned into every turn's prompt; never recomputed once active.
  matter_summary_jsonb     jsonb not null default '{}'::jsonb,

  role                     mock_argument_role not null,
  judge_persona            mock_argument_judge_persona not null default 'neutral',
  planned_duration_seconds integer,                      -- null = open-ended
  input_mode               mock_argument_input_mode not null default 'text',

  status                   mock_argument_session_status not null default 'setup',
  started_at               timestamptz not null default now(),
  ended_at                 timestamptz,

  -- Cached scalar from the review pass so the list view doesn't have to
  -- join mock_argument_reviews. Null until the session is concluded.
  overall_score            numeric(5,2),

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint mock_argument_sessions_source_xor check (
    (case_id is not null and upload_id is null)
    or (case_id is null and upload_id is not null)
  )
);

create index if not exists mock_argument_sessions_firm_user_idx
  on mock_argument_sessions (firm_id, user_id, started_at desc);

create index if not exists mock_argument_sessions_status_idx
  on mock_argument_sessions (status) where status = 'active';

do $$ begin
  create trigger trg_mock_argument_sessions_updated
    before update on mock_argument_sessions
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- turns -----------------------------------------------------------------
-- Append-only. turn_number is monotonically increasing per session and is
-- assigned server-side under a single-statement insert to avoid a race.

create table if not exists mock_argument_turns (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references mock_argument_sessions(id) on delete cascade,
  turn_number     integer not null,
  speaker         mock_argument_speaker not null,
  transcript      text not null,

  -- Citations attached to an AI turn: { statutes: [...], judgments: [...] }.
  -- Null on user turns (their citations are scraped from the transcript at
  -- review time, not stored per-turn).
  citations_jsonb jsonb,

  -- Per-turn rubric for user turns. Null on AI turns and on user turns
  -- before the review pass runs. Slice 1 leaves this null and only writes
  -- the aggregate review row; a future slice can populate this from the
  -- review LLM call.
  rating_jsonb    jsonb,

  created_at      timestamptz not null default now(),

  constraint mock_argument_turns_unique_number
    unique (session_id, turn_number)
);

create index if not exists mock_argument_turns_session_idx
  on mock_argument_turns (session_id, turn_number);

-- ---- reviews ---------------------------------------------------------------
-- One row per concluded session.

create table if not exists mock_argument_reviews (
  id                      uuid primary key default gen_random_uuid(),
  session_id              uuid not null unique
                            references mock_argument_sessions(id) on delete cascade,

  -- Rubric: { legalSoundness, citationUse, structure, persuasiveness,
  --           responsiveness } each 0–5 + overall 0–100.
  rubric_jsonb            jsonb not null default '{}'::jsonb,
  strengths               text[] not null default '{}',
  weaknesses              text[] not null default '{}',
  -- [{ point, statute|judgment, why }]
  missed_arguments_jsonb  jsonb not null default '[]'::jsonb,
  -- [{ title, citation, why }]
  study_list_jsonb        jsonb not null default '[]'::jsonb,

  -- Free-form 2–3 sentence narrative summary.
  qualitative_summary     text,

  generated_at            timestamptz not null default now()
);

-- ---- RBAC ------------------------------------------------------------------

insert into features (key, name, description, domain, default_baseline) values
  ('mock_arguments.use',
   'Mock arguments',
   'Run AI-opposed oral-advocacy practice sessions grounded in case facts and the law corpus.',
   'review',
   false)
on conflict (key) do nothing;

-- All three plan tiers see the feature. Solo gets the same access as Firm —
-- a meter / quota can layer on later without touching the plan matrix.
insert into plan_features (plan_tier, feature_key, enabled)
select t::firm_plan_tier, 'mock_arguments.use', true
from unnest(array['Solo','Practice','Firm']) as t
on conflict (plan_tier, feature_key) do nothing;

-- Every system role that already has matter.view inherits mock_arguments.use.
-- Same inference pattern that 0033 used for matter.notes.view.
insert into role_features (role_id, feature_key, enabled)
select rf.role_id, 'mock_arguments.use', true
from role_features rf
where rf.feature_key = 'matter.view' and rf.enabled = true
on conflict (role_id, feature_key) do nothing;
