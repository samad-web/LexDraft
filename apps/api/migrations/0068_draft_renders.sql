-- =============================================================================
-- 0068_draft_renders — the authoritative rendered artifacts for an engine draft.
--
-- Until now the engine's fully-rendered .docx (docx_base64) was received by Node
-- and discarded: the web PREVIEWED an HTML composition of blocks[] and DOWNLOADED a
-- client-side jsPDF/html2canvas re-render. Two renderers of the same document ->
-- the advocate approved one artifact and filed another. This table backs the single
-- rendering path: the engine .docx is stored, converted to PDF by a pg-boss worker
-- (LibreOffice headless), and BOTH artifacts are served from here. The web previews
-- the PDF (pdfjs) and downloads the .docx.
--
-- ADDITIVE ONLY. The existing drafts.edited_html / body_text / fields_json columns
-- are untouched — existing drafts still reference them and the model/legacy path
-- still writes them. This table sits alongside, keyed to the ENGINE identity
-- (matter_id + fact-sheet version), which is what the sign-off invariant keys on.
--
-- One render per (matter_id, fact_sheet_version): the render is a pure function of
-- the facts at that version and the template that produced it. The unique constraint
-- makes the render job idempotent — a pg-boss retry upserts the same row rather than
-- creating a duplicate S3 object.
-- =============================================================================

do $$ begin
  create type draft_render_status as enum ('pending', 'ready', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists draft_renders (
  id                  uuid primary key default gen_random_uuid(),

  -- tenancy — same firm/user model as the rest of the schema. firm_id scopes the
  -- ownership check the /drafts/:id/render endpoint enforces before presigning URLs.
  firm_id             uuid references firms(id) on delete cascade,

  -- The engine matter identity (fact_sheets.matter_id) and the exact version whose
  -- facts produced this render. (matter_id, version) is the sign-off key, so the
  -- rendered artifact is tied to precisely the version the advocate reviews/approves.
  matter_id           uuid not null,
  fact_sheet_version  integer not null check (fact_sheet_version >= 1),

  -- Optional link back to a saved drafts row when the render originated from one.
  -- Nullable: an engine draft can be rendered before it is ever saved as a draft.
  draft_id            uuid references drafts(id) on delete set null,

  doc_type            text not null,

  -- WHICH TEMPLATE produced this render. Recorded so that after Task 3 re-authors
  -- the templates we can identify every draft rendered against the OLD builder
  -- output (template_version bumps; a query finds the stale renders to re-run).
  template_id         text not null default '',
  template_version    integer not null default 0,

  -- The LibreOffice build that produced the PDF. A soffice minor bump can shift
  -- pagination -> a different page count than the advocate approved; recording it
  -- makes that visible and lets us pin/compare.
  soffice_version     text not null default '',

  -- S3 (or local-driver) keys for the two artifacts. Bytes live in storage, never
  -- in the DB (jobs.service convention). pdf_key is null until conversion succeeds.
  docx_key            text,
  pdf_key             text,

  render_status       draft_render_status not null default 'pending',
  error_detail        text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Idempotency: one render per matter version. The job's upsert targets this.
  unique (matter_id, fact_sheet_version)
);

create index if not exists draft_renders_firm_idx
  on draft_renders (firm_id, updated_at desc);
create index if not exists draft_renders_matter_idx
  on draft_renders (matter_id, fact_sheet_version desc);
-- Find renders produced against a given template version (the Task 3 staleness query).
create index if not exists draft_renders_template_idx
  on draft_renders (template_id, template_version);

do $$ begin
  create trigger trg_draft_renders_updated
    before update on draft_renders
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
