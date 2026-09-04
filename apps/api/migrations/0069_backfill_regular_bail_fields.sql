-- =============================================================================
-- 0069_backfill_regular_bail_fields — saved-draft safety for the Regular Bail
-- form migration (hand-authored web form -> engine-generated form).
--
-- The generated Regular Bail form uses the ENGINE field keys (accused address is
-- `address`, not `accused_address`, etc.). Saved drafts store fields_json under the
-- OLD web keys. Without this, an advocate opening an existing Bail draft would find
-- the migrated fields blank. This one-time backfill copies each pure-rename old-key
-- value to its new engine key, IN ADDITION to leaving the old key in place (so the
-- web dual-read still works either way and nothing is lost).
--
-- SAFETY:
--   * Additive: we only SET a new key when it is absent/empty; we never overwrite a
--     value the advocate already has under the new key, and never delete the old key.
--   * Scoped: only rows with doc_type = 'Bail Application' (the web label the picker
--     used) are touched.
--   * Renames only: fields whose SHAPE changed (custody_days -> custody_since date,
--     arrest_status, bail_type) are DELIBERATELY NOT mapped — mapping a day-count into
--     a date field would be wrong. Those remain under their old keys; the advocate
--     re-enters them (the form surfaces them as empty required fields, the correct
--     signal). This SQL mirrors form-gen/key-aliases.ts `renames` exactly; keep them
--     in sync.
--
-- Idempotent: re-running is a no-op because each SET is guarded on the new key being
-- absent/empty.
-- =============================================================================

-- The pure renames: newEngineKey <- oldWebKey. (Must match KEY_ALIASES.regular_bail.renames.)
--   accused_name   <- accused_name    (same key; no-op but listed for completeness)
--   address        <- accused_address
--   fir_no         <- fir_no
--   police_station <- police_station
--   sections       <- sections
--   grounds        <- grounds
-- Only `address` differs in key name and needs a copy.

update drafts
set fields_json = jsonb_set(
      fields_json,
      '{address}',
      fields_json -> 'accused_address',
      true
    )
where doc_type = 'Bail Application'
  and fields_json ? 'accused_address'
  and coalesce(fields_json ->> 'accused_address', '') <> ''
  -- only when the new key is absent or empty (don't clobber an existing value)
  and coalesce(fields_json ->> 'address', '') = '';

-- (accused_name, fir_no, police_station, sections, grounds keep the same key names, so
--  no copy is needed — the generated form reads them directly.)
