-- =============================================================================
-- LexDraft — Physical document register
-- =============================================================================
-- The sidebar previously labelled `/app/archive` as "Physical Docs" but the
-- view it pointed at is the closed-matters archive — not a register of
-- paper documents. This migration introduces a real physical-document
-- register so advocates can track the originals (vakalatnamas, sworn
-- affidavits, signed contracts, etc.) that live in the chambers cabinet
-- or court file room.
--
-- The case_id link is optional so a doc can be tracked even before it's
-- assigned to a matter. file_no is unique per firm so a barcode/file-room
-- number can't collide.
--
-- Idempotent.
-- =============================================================================

create table if not exists physical_documents (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references firms(id) on delete cascade,
  case_id      uuid references cases(id) on delete set null,
  -- Denormalised matter title shown in lists when case_id is null or the
  -- linked case is renamed. Always populated so list views stay fast.
  case_label   text,
  -- Physical file/folder/cabinet identifier — barcode or hand-written ref.
  file_no      text not null,
  title        text not null,
  -- Free-text classifier ("Original deed", "Affidavit", "Court order"…) —
  -- not enumerated because Indian-practice paperwork is too varied.
  doc_type     text,
  location     text not null,
  custodian    text,
  status       text not null default 'in_chambers'
    check (status in ('in_chambers','court_file','client','co_counsel','archive_box','lost','returned')),
  notes        text,
  received_at  date,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists physical_documents_firm_idx on physical_documents (firm_id);
create index if not exists physical_documents_case_idx on physical_documents (case_id);
create unique index if not exists physical_documents_firm_fileno_uq
  on physical_documents (firm_id, lower(file_no))
  where archived_at is null;

do $$ begin
  create trigger trg_physical_documents_updated
    before update on physical_documents
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
