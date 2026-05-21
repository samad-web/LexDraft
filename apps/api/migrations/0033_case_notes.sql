-- =============================================================================
-- 0033_case_notes.sql
-- =============================================================================
-- Per-matter notes. Two production use-cases:
--
--   1. Advocates capture facts, working theories, witness summaries, and
--      strategy memos attached to a specific case.
--   2. The drafting flow surfaces a banner before generation - "N notes on
--      this matter, include as context?" - and on opt-in, the note bodies
--      are appended to the LLM user message. This is why every note has a
--      `body text` column even for uploaded files (text-extracted on
--      finalize) - the AI consumes `body`, not the original blob.
--
-- Visibility model:
--   * shared   - any firm member with matter.view sees the note
--   * private  - only the author sees the note (still firm-scoped at the
--                row level via firm_id; private is the within-firm filter)
--
-- Edit/delete is always author-only regardless of visibility - a shared
-- note is not a wiki, it's "this advocate's note, made readable to the
-- firm". Firm-admin override is intentionally out of scope.
--
-- Source model:
--   * typed    - body is what the user typed
--   * uploaded - body is text extracted from storage_key blob (PDF/DOCX/
--                TXT/MD). Original blob stays in object storage; we keep
--                file_name/mime/size for the UI and for re-extraction.
--                extraction_status surfaces success/failure to the UI.
-- =============================================================================

do $$ begin
  create type case_note_visibility as enum ('shared', 'private');
exception when duplicate_object then null; end $$;

do $$ begin
  create type case_note_source as enum ('typed', 'uploaded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type case_note_extraction_status as enum ('pending', 'ok', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists case_notes (
  id                 uuid primary key default gen_random_uuid(),
  firm_id            uuid not null references firms(id) on delete cascade,
  case_id            uuid not null references cases(id) on delete cascade,
  author_user_id     uuid not null references users(id) on delete restrict,
  visibility         case_note_visibility not null default 'shared',
  source             case_note_source not null default 'typed',

  title              text,
  -- The AI-consumable text. For typed notes this is what the user typed;
  -- for uploaded notes it is the text-extraction output. Default '' lets
  -- the row exist while extraction is still 'pending'.
  body               text not null default '',

  -- Upload metadata. Null for typed notes.
  storage_key        text,
  file_name          text,
  file_mime          text,
  file_size          integer,
  extraction_status  case_note_extraction_status,
  extraction_error   text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- A typed note never carries upload metadata; an uploaded note must
  -- carry storage_key. Either of these being inconsistent indicates a
  -- service bug, not user input - the CHECK is defence-in-depth.
  constraint case_notes_source_shape check (
    case source
      when 'typed'    then storage_key is null and extraction_status is null
      when 'uploaded' then storage_key is not null
    end
  )
);

-- Most queries are "all notes for this case in createdAt-desc order"; the
-- (case_id, created_at desc) composite covers the list view directly.
create index if not exists case_notes_case_idx
  on case_notes (case_id, created_at desc);

-- Tenant isolation: every read filters firm_id first to refuse cross-tenant
-- access, even if a caller manages to pass an id from another firm.
create index if not exists case_notes_firm_idx
  on case_notes (firm_id);

-- Used by the "my private notes" partial filter in the list query.
create index if not exists case_notes_author_idx
  on case_notes (author_user_id);

do $$ begin
  create trigger trg_case_notes_updated
    before update on case_notes
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- RBAC features (matter.notes.*) ----------------------------------------
-- We use granular keys rather than reuse matter.view / matter.create so a
-- firm admin can later restrict note creation to a subset of users without
-- blocking matter creation itself. Each key is wired into the Solo /
-- Practice / Firm plan-features matrix (Solo gets read+write, mirroring
-- matter.view + matter.create).
insert into features (key, name, description, domain, default_baseline) values
  ('matter.notes.view',   'View case notes',   'Read notes attached to a matter (shared notes + own private notes).', 'matter', false),
  ('matter.notes.create', 'Author case notes', 'Add, edit, and delete case notes you own.',                            'matter', false)
on conflict (key) do nothing;

-- Plan -> features. All three tiers see + author notes; metering / quotas
-- can be layered on later without changing the plan matrix.
insert into plan_features (plan_tier, feature_key, enabled)
select t::firm_plan_tier, k, true
from unnest(array['Solo','Practice','Firm']) as t,
     unnest(array['matter.notes.view','matter.notes.create']) as k
on conflict (plan_tier, feature_key) do nothing;

-- Role -> features. Every system role that already has matter.view gets
-- matter.notes.view; every role with matter.create gets matter.notes.create.
-- (Mirrors the inference pattern used by 0012 for billing -> reports.billing.)
insert into role_features (role_id, feature_key, enabled)
select rf.role_id, 'matter.notes.view', true
from role_features rf
where rf.feature_key = 'matter.view' and rf.enabled = true
on conflict (role_id, feature_key) do nothing;

insert into role_features (role_id, feature_key, enabled)
select rf.role_id, 'matter.notes.create', true
from role_features rf
where rf.feature_key = 'matter.create' and rf.enabled = true
on conflict (role_id, feature_key) do nothing;
