-- =============================================================================
-- LexDraft — Diary entry attachments (Judgment PDFs)
-- =============================================================================
-- Diary captures three kinds of events: hearing / judgment / filing. For
-- judgments specifically, advocates want a place to drop the certified copy
-- PDF the moment the order is pronounced — so the diary row carries the file
-- as well as the metadata.
--
-- Storage shape mirrors the pre-presigned-URL path used by `documents` (see
-- packages/types `DocumentRecord.fileBase64`): the bytes are persisted as
-- base64 text on the row itself, indexed by mime/size for sanity checks. The
-- file is small (judgment copies are usually < 5 MB) and this keeps the
-- diary entry self-contained — no joins against `documents`, no presigned
-- URL plumbing on the diary route. If a future iteration moves the storage
-- to the object-storage driver, the columns convert cleanly to a
-- storage_key reference.

alter table if exists diary_entries
  add column if not exists attachment_file_name   text         null,
  add column if not exists attachment_mime        text         null,
  add column if not exists attachment_size_bytes  integer      null,
  add column if not exists attachment_base64      text         null;
