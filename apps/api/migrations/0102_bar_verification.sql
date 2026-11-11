-- Bar Council enrolment verification (build-docs/features/bar-council-verification.md).
-- Additive only: nullable columns on users. Existing users stay null (= never checked).
--
-- bar_council               council id from lib/bar-councils.ts (e.g. 'tn')
-- bar_verification_status   verified | not_found | name_mismatch | unavailable | unsupported
-- bar_verification_source   where the record came from (e.g. 'bctnpy.org')
-- bar_record                what the council returned: name, enrolment no./date, status
alter table users add column if not exists bar_council text;
alter table users add column if not exists bar_verification_status text
  check (bar_verification_status in ('verified', 'not_found', 'name_mismatch', 'unavailable', 'unsupported'));
alter table users add column if not exists bar_verification_source text;
alter table users add column if not exists bar_record jsonb;
alter table users add column if not exists bar_checked_at timestamptz;
alter table users add column if not exists bar_verified_at timestamptz;
