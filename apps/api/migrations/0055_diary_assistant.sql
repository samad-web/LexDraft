-- =============================================================================
-- LexDraft — Diary assistant: cached judgment-PDF insights
-- =============================================================================
-- The Diary assistant can read a judgment PDF attached to a diary entry and
-- distil it (summary / holding / suggested follow-ups). That work is expensive
-- (PDF text extraction + an LLM call) so the result is cached per diary entry,
-- keyed by a content hash of the extracted text. Re-opening an analysed
-- judgment is a cache hit; re-analysing the *same* bytes is a no-op.
--
-- The (diary_entry_id, content_hash) pair is the cache key. A diary entry's
-- attachment is currently immutable (no edit path), so today there is one row
-- per analysed entry; the content_hash component is forward-looking — if an
-- attachment-replace path is added later, the new bytes hash differently and a
-- fresh row is written without a migration.
--
-- firm_id is denormalised onto the row (diary_entries already carries it) so
-- per-firm reads never have to join, matching the tenancy pattern used across
-- the schema. Both keys are NOT NULL — every write path populates them.
-- Idempotent.
-- =============================================================================

create table if not exists diary_entry_insights (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references firms(id) on delete cascade,
  diary_entry_id  uuid not null references diary_entries(id) on delete cascade,
  content_hash    text not null,
  summary         text not null default '',
  holding         text not null default '',
  follow_ups      jsonb not null default '[]'::jsonb,
  model_used      text not null default '',
  created_at      timestamptz not null default now()
);

create index if not exists diary_entry_insights_firm_idx
  on diary_entry_insights (firm_id);

-- One cached insight per (entry, content hash). A re-analysis of the same bytes
-- upserts this row (see writeCachedInsight); a future replaced PDF gets a new
-- hash + row.
create unique index if not exists diary_entry_insights_entry_hash_idx
  on diary_entry_insights (diary_entry_id, content_hash);
