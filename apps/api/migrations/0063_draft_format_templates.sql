-- =============================================================================
-- 0063_draft_format_templates — the advocate's OWN drafting formats.
--
-- Distinct from:
--   * doc-templates (static pre-filled briefs, web-only) and
--   * engagement_templates (0024 — scope/fee clauses for engagement letters).
-- This table stores a firm's reusable DOCUMENT FORMAT: their letterhead lines,
-- clause style, section order, and [placeholders]. When a draft is generated
-- with a format selected, the agent fills THIS format instead of the default
-- skeleton — so the output matches the firm's house style.
--
-- The body is plain text (pasted, or extracted from an uploaded .docx/.txt via
-- mammoth at upload time). We store text, not the binary, so drafting is a
-- pure string operation and the format is diffable / editable in-app.
-- =============================================================================

create table if not exists draft_format_templates (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references firms(id) on delete cascade,
  name         text not null,
  -- Optional: the doc type this format is meant for (e.g. "Bail Application").
  -- Empty = a general format usable for any document.
  doc_type     text not null default '',
  -- The format itself: the advocate's structure/clauses with [placeholders].
  body         text not null,
  -- 'paste' | 'upload' — provenance, for the UI.
  source       text not null default 'paste',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references users(id) on delete set null
);

create index if not exists draft_format_templates_firm_idx
  on draft_format_templates (firm_id, doc_type);

do $$ begin
  create trigger trg_draft_format_templates_updated
    before update on draft_format_templates
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
