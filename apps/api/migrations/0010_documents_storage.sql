-- =============================================================================
-- LexDraft - Document storage metadata
-- =============================================================================
-- Adds the columns needed to back the presigned-URL upload flow:
--   storage_key  - opaque key in the configured storage driver (local|s3|r2)
--   file_name    - original filename the user uploaded
--   file_mime    - MIME type recorded at upload time
--   file_size    - byte count
-- All idempotent.
-- =============================================================================

alter table documents add column if not exists storage_key text;
alter table documents add column if not exists file_name   text;
alter table documents add column if not exists file_mime   text;
alter table documents add column if not exists file_size   bigint;

create index if not exists documents_storage_key_idx on documents (storage_key)
  where storage_key is not null;
