-- =============================================================================
-- 0070_documents_extracted_text_cache — cache the OCR/parsed text of an uploaded
-- document so it is extracted ONCE, not on every draft.
--
-- WHY: caseDocumentText() re-ran pdf-parse + OCR on every /documents/case-text
-- call (i.e. every time the Draft modal opened). For a large scanned PDF this
-- took MINUTES (measured 205s for an 11.5 MB agreement), so the web fetch timed
-- out / was still pending when the advocate hit Submit — the document's text
-- never reached the engine and the draft came out empty ("it doesn't even take
-- the content"). Caching the extracted text makes the second+ read instant.
--
-- ADDITIVE ONLY. Nullable columns; existing rows read as "not yet extracted" and
-- get populated lazily on the next read. `extracted_source_size` records the
-- file_size the text was extracted from, so a re-uploaded/replaced file (new
-- size) invalidates the cache and is re-extracted.
-- =============================================================================

alter table documents
  add column if not exists extracted_text        text,
  add column if not exists extracted_at          timestamptz,
  add column if not exists extracted_source_size bigint,
  -- true when extraction ran but produced no usable text (blank scan / OCR
  -- failed): cache the NEGATIVE result too, so we don't re-OCR an unreadable
  -- file on every draft. Distinguishes "not tried yet" (null) from "tried,
  -- nothing" (true).
  add column if not exists extracted_empty       boolean;
