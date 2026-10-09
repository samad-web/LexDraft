-- ---- matter_facts -----------------------------------------------------------
--
-- Promotes matter_document_summaries.key_dates (an untyped jsonb blob,
-- re-synthesized into lossy prose by a second LLM call every time
-- matter_briefs.timeline is regenerated) into real rows: one per dated event,
-- with a typed date for genuine chronological sorting, a source document to
-- attribute it to, and a dedupe key so re-summarizing a document (or two
-- documents independently mentioning the same event) doesn't produce
-- duplicate/conflicting timeline entries.
--
-- This does NOT add a new LLM extraction pass. summariseDocument() already
-- asks for key_dates on every ingest (matter-intel.service.ts SUMMARY_SYSTEM)
-- — that output is free; this table just gives it a structured home instead
-- of leaving it stranded in jsonb. The brief's prose timeline (matter_briefs
-- .timeline) is unaffected and still generated the same way; matter_facts is
-- an additive, queryable alternative a UI can render without another LLM call.

create table if not exists matter_facts (
  id                    uuid primary key default gen_random_uuid(),
  firm_id               uuid not null references firms(id)              on delete cascade,
  case_id               uuid not null references cases(id)              on delete cascade,
  matter_document_id    uuid not null references matter_documents(id)   on delete cascade,

  -- Null when the source key_dates entry had no parseable date (the summary
  -- schema allows date: null) — still worth keeping as an undated fact rather
  -- than dropping it, but it sorts last in any date-ordered view.
  event_date            date,
  event_text            text not null,

  -- Case-insensitive, whitespace-normalized (event_date || ':' || lower(trim(event_text)))
  -- computed in application code, not SQL, because the normalization needs to
  -- match near-duplicates (punctuation/whitespace drift between two
  -- documents describing the same event), which is easier to get right in TS
  -- than in a generated column expression.
  dedupe_key            text not null,

  source_file_name      text not null,
  generated_at          timestamptz not null default now(),
  created_at            timestamptz not null default now(),

  -- Re-summarizing a document (user re-ingests, or the LLM call is retried)
  -- replaces that document's facts wholesale rather than appending —
  -- matter-intel.service.ts deletes-then-reinserts per matter_document_id,
  -- same idempotency pattern matter_document_chunks already uses.
  constraint matter_facts_dedupe_uniq unique (case_id, dedupe_key)
);

create index if not exists matter_facts_case_date_idx
  on matter_facts (case_id, event_date asc nulls last);
create index if not exists matter_facts_document_idx
  on matter_facts (matter_document_id);
