-- =============================================================================
-- LexDraft - saved drafts
-- =============================================================================
-- Backs the "Save" / "My drafts" feature on the Drafting view. Each row stores
-- everything needed to round-trip a draft back into the editor: the brief
-- inputs, the streamed body text, and any rich-text edits the lawyer made.
-- Idempotent.
-- =============================================================================

do $$ begin
  create type draft_language as enum ('EN', 'HI', 'TA');
exception when duplicate_object then null; end $$;

create table if not exists drafts (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid references firms(id) on delete cascade,
  user_id         uuid references users(id) on delete set null,
  title           text not null,
  doc_type        text not null,
  language        draft_language not null default 'EN',
  tone            text not null default 'Professional',
  fields_json     jsonb not null default '{}'::jsonb,
  edited_html     text not null default '',
  body_text       text not null default '',
  draft_date      date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists drafts_user_updated_idx on drafts (user_id, updated_at desc);
create index if not exists drafts_firm_updated_idx on drafts (firm_id, updated_at desc);

do $$ begin
  create trigger trg_drafts_updated
    before update on drafts
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
