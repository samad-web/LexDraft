-- import-edit-document (build-docs/features/import-edit-document.md). Additive.
-- A draft opened from the advocate's own file remembers that file (the original,
-- never changed) and the Documents row holding its edited Word copy.
alter table drafts add column if not exists source_document_id uuid references documents(id) on delete set null;
alter table drafts add column if not exists edited_document_id uuid references documents(id) on delete set null;
