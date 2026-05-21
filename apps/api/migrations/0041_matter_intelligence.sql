-- =============================================================================
-- 0041_matter_intelligence.sql
-- =============================================================================
-- Matter Intelligence — document ingestion, per-document AI summaries,
-- matter-level synthesis (a "brief"), and per-matter chat grounded in the
-- ingested corpus.
--
-- The feature lives inside CaseDetailView as an "Intelligence" tab and as a
-- standalone view at /app/matter-intel/:caseId. Every artefact is firm-scoped
-- and case-scoped: there is no cross-tenant retrieval surface.
--
-- Storage model:
--   * matter_documents       — pointer rows. Source is either an upload or a
--                              pull from the existing `documents` table.
--                              Holds extracted text and a content_hash so
--                              re-ingesting the same bytes is a no-op.
--   * matter_document_chunks — page-aware retrieval units. ~800-token target
--                              with 100-token overlap. The 1024-d embedding
--                              matches services/embeddings.service.ts (BAAI/
--                              bge-m3, EMBEDDING_DIMS=1024).
--   * matter_document_summaries — one row per matter_documents row. The
--                              structured per-document summary; JSONB so
--                              schema can evolve without migrations.
--   * matter_briefs          — matter-level synthesis. We keep history:
--                              regeneration marks the previous row with
--                              `superseded_at` and inserts a new one.
--   * matter_chat_threads    — per (matter, user) chat sessions.
--   * matter_chat_messages   — role-tagged messages with retrieval citations
--                              in `citations` JSONB.
--
-- Tenant isolation: every read query MUST filter firm_id. The (firm_id,
-- case_id) composite indexes ride the dominant access pattern. A separate
-- HNSW index on the embedding column covers vector retrieval.
--
-- pgvector: the main app database does not yet have the `vector` extension
-- enabled (the laws corpus uses a separate DB). We enable it here. The
-- extension must already be installed on the Postgres server — `apt install
-- postgresql-16-pgvector` or the managed-DB equivalent. The `create
-- extension` itself is idempotent.
-- =============================================================================

create extension if not exists vector;

-- ---- enums ------------------------------------------------------------------

do $$ begin
  create type matter_doc_source as enum ('upload', 'matter_document');
exception when duplicate_object then null; end $$;

do $$ begin
  create type matter_doc_status as enum ('pending', 'extracting', 'embedding', 'ready', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type matter_chat_role as enum ('user', 'assistant');
exception when duplicate_object then null; end $$;

-- ---- matter_documents -------------------------------------------------------

create table if not exists matter_documents (
  id                  uuid primary key default gen_random_uuid(),
  firm_id             uuid not null references firms(id)  on delete cascade,
  case_id             uuid not null references cases(id)  on delete cascade,
  ingested_by         uuid not null references users(id)  on delete restrict,

  source_type         matter_doc_source not null,
  -- Only set when source_type = 'matter_document'. The FK lets us follow back
  -- to the original blob if the user later updates it in the documents tab;
  -- on delete-set-null we keep the matter-intel row (extracted text + chunks
  -- remain valid for retrieval and audit).
  source_document_id  uuid references documents(id) on delete set null,

  file_name           text not null,
  file_size_bytes     bigint,
  mime_type           text,
  -- Opaque key in the configured storage driver (mirror of documents.storage_key).
  storage_ref         text,
  -- SHA-256 of the original file contents; used to short-circuit re-ingest of
  -- the same bytes (we keep extracted_text + chunks rather than redoing work).
  content_hash        text,

  extracted_text      text,
  page_count          integer,

  status              matter_doc_status not null default 'pending',
  status_error        text,

  ingested_at         timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Either an upload (storage_ref set, source_document_id null) or a pull
  -- (source_document_id set). Defence-in-depth against service-level bugs.
  constraint matter_documents_source_shape check (
    case source_type
      when 'upload'           then source_document_id is null
      when 'matter_document'  then source_document_id is not null
    end
  ),

  -- Idempotent ingest: re-uploading the same bytes for the same matter is a
  -- no-op. Hash may be null until extraction completes.
  constraint matter_documents_case_hash_uniq unique (case_id, content_hash)
);

create index if not exists matter_documents_firm_case_idx
  on matter_documents (firm_id, case_id, ingested_at desc);
create index if not exists matter_documents_status_idx
  on matter_documents (status)
  where status in ('pending', 'extracting', 'embedding');

do $$ begin
  create trigger trg_matter_documents_updated
    before update on matter_documents
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- matter_document_chunks -------------------------------------------------

create table if not exists matter_document_chunks (
  id                    uuid primary key default gen_random_uuid(),
  firm_id               uuid not null references firms(id)            on delete cascade,
  matter_document_id    uuid not null references matter_documents(id) on delete cascade,
  chunk_index           integer not null,
  -- 1-based page number where the chunk *starts*. Useful for citation render.
  -- DOCX has no pages; for those we approximate one logical "page" per
  -- ~3000-character window so the citation contract stays uniform.
  page_number           integer not null,
  -- Character offsets inside extracted_text so the UI can scroll the source
  -- preview to the cited region even when page_number is approximate.
  char_start            integer not null,
  char_end              integer not null,
  text                  text not null,
  -- token_count is informational — chunk sizing is enforced in the service
  -- layer with a tokenizer; this column lets us audit drift.
  token_count           integer,
  embedding             vector(1024),

  created_at            timestamptz not null default now(),

  constraint matter_document_chunks_index_uniq unique (matter_document_id, chunk_index)
);

create index if not exists matter_document_chunks_firm_doc_idx
  on matter_document_chunks (firm_id, matter_document_id, chunk_index);

-- HNSW is the right default for our recall/latency profile (per-matter
-- corpora are small — tens to low hundreds of chunks — and we never need
-- IVFFlat's training step). Cosine distance matches BGE-m3 semantics.
-- Build params chosen for low-write, frequent-read workloads.
create index if not exists matter_document_chunks_embedding_idx
  on matter_document_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ---- matter_document_summaries ----------------------------------------------

create table if not exists matter_document_summaries (
  id                    uuid primary key default gen_random_uuid(),
  firm_id               uuid not null references firms(id)            on delete cascade,
  matter_document_id    uuid not null references matter_documents(id) on delete cascade,

  -- Plain-text classification (e.g. 'order', 'pleading', 'contract',
  -- 'fir', 'statement_161', 'agreement'). Free-form so the LLM is not
  -- forced into a fixed taxonomy that will drift; the UI maps known
  -- values onto chips and falls back to title-case.
  document_type         text,
  -- [{ name, role }]
  parties               jsonb not null default '[]'::jsonb,
  -- [{ date, event }]  ISO-8601 strings; we store as JSON rather than
  -- typed columns because most documents have several relevant dates.
  key_dates             jsonb not null default '[]'::jsonb,
  operative_content     text,
  -- [{ statute_or_case, reference }]
  citations             jsonb not null default '[]'::jsonb,
  executive_summary     text,

  model_used            text not null,
  generated_at          timestamptz not null default now(),

  -- One canonical summary per matter document; regeneration overwrites.
  constraint matter_document_summaries_doc_uniq unique (matter_document_id)
);

create index if not exists matter_document_summaries_firm_idx
  on matter_document_summaries (firm_id);

-- ---- matter_briefs ----------------------------------------------------------

create table if not exists matter_briefs (
  id                 uuid primary key default gen_random_uuid(),
  firm_id            uuid not null references firms(id) on delete cascade,
  case_id            uuid not null references cases(id) on delete cascade,
  generated_by       uuid references users(id) on delete set null,

  posture            text,
  key_facts          jsonb not null default '[]'::jsonb,
  disputed_issues    jsonb not null default '[]'::jsonb,
  -- [{ date, event }]
  timeline           jsonb not null default '[]'::jsonb,
  open_questions     jsonb not null default '[]'::jsonb,

  model_used         text not null,
  generated_at       timestamptz not null default now(),
  -- When non-null, this row has been replaced by a newer brief for the same
  -- matter. The "current" brief is the row with superseded_at is null.
  superseded_at      timestamptz
);

-- "Current brief" lookup is the dominant query — partial index keeps it
-- O(1) regardless of how much history accumulates.
create unique index if not exists matter_briefs_current_uniq
  on matter_briefs (case_id)
  where superseded_at is null;

create index if not exists matter_briefs_firm_case_idx
  on matter_briefs (firm_id, case_id, generated_at desc);

-- ---- matter_chat_threads ----------------------------------------------------

create table if not exists matter_chat_threads (
  id                 uuid primary key default gen_random_uuid(),
  firm_id            uuid not null references firms(id) on delete cascade,
  case_id            uuid not null references cases(id) on delete cascade,
  user_id            uuid not null references users(id) on delete cascade,

  title              text,
  created_at         timestamptz not null default now(),
  last_message_at    timestamptz not null default now()
);

create index if not exists matter_chat_threads_firm_case_user_idx
  on matter_chat_threads (firm_id, case_id, user_id, last_message_at desc);

-- ---- matter_chat_messages ---------------------------------------------------

create table if not exists matter_chat_messages (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references firms(id)                on delete cascade,
  thread_id     uuid not null references matter_chat_threads(id)  on delete cascade,
  role          matter_chat_role not null,
  content       text not null,
  -- [{ matter_document_id, page, snippet }]. Empty for user messages; for
  -- assistant messages this is the citation surface the UI renders as inline
  -- pill links. A zero-length array is a flag: "the model could not ground
  -- this answer in the corpus" — the UI surfaces a soft warning.
  citations     jsonb not null default '[]'::jsonb,
  model_used    text,
  created_at    timestamptz not null default now()
);

create index if not exists matter_chat_messages_thread_idx
  on matter_chat_messages (thread_id, created_at asc);
create index if not exists matter_chat_messages_firm_idx
  on matter_chat_messages (firm_id);

-- ---- feature flag wiring ----------------------------------------------------
-- Single dotted key consistent with the existing key namespace (see 0009 +
-- 0033 for prior art). The build prompt asks for the feature to be in the
-- BASELINE set initially; we add it as default_baseline = true so any user,
-- regardless of plan or role, sees the feature surface. We can tighten later
-- by flipping default_baseline to false and writing role/plan grants.

insert into features (key, name, description, domain, default_baseline) values
  ('matter.intelligence',
   'Matter Intelligence',
   'Upload or pull matter documents, generate AI summaries and a synthesised brief, and chat against the matter corpus with cited answers.',
   'matter',
   true)
on conflict (key) do nothing;

-- Even with default_baseline=true the plan_features matrix is consulted for
-- the layered gate; mirror Solo/Practice/Firm so plan-level toggles work.
insert into plan_features (plan_tier, feature_key, enabled)
select t::firm_plan_tier, 'matter.intelligence', true
from unnest(array['Solo','Practice','Firm']) as t
on conflict (plan_tier, feature_key) do nothing;
