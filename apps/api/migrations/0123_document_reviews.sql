-- review-copy (build-docs/features/review-copy.md). Additive.
-- A frozen PDF copy of a draft or case document that the advocate marks up with
-- a pen and margin notes; the source itself is never changed.
create table if not exists document_reviews (
  id                  uuid primary key default gen_random_uuid(),
  firm_id             uuid not null references firms(id) on delete cascade,
  user_id             uuid references users(id) on delete set null,
  case_label          text not null default '-',
  title               text not null,
  source              text not null check (source in ('draft', 'document')),
  draft_id            uuid references drafts(id) on delete set null,
  source_document_id  uuid references documents(id) on delete set null,
  source_updated_at   timestamptz,
  snapshot_key        text not null,
  page_count          int not null default 0,
  marks               jsonb not null default '{"pages":[]}'::jsonb,
  notes               jsonb not null default '[]'::jsonb,
  result_document_id  uuid references documents(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists document_reviews_firm_idx on document_reviews (firm_id, updated_at desc);
create index if not exists document_reviews_draft_idx on document_reviews (draft_id);

do $$ begin
  create trigger trg_document_reviews_updated
    before update on document_reviews
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
