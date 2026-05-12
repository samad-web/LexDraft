-- =============================================================================
-- 0030_signup_profile_fields.sql
-- =============================================================================
-- Persist the profile details collected at sign-up so downstream surfaces
-- (Settings → Letterhead, profile cards, invoices) can auto-populate from
-- them instead of asking the user a second time.
--
-- Before this migration these fields were captured in the AuthView form
-- but silently dropped before the request was sent — solo advocates had
-- to re-enter their enrolment number and chambers details when designing
-- a letterhead. With these columns the LetterheadEditor seeds the slot
-- fields directly from /auth/me so a solo advocate can save a letterhead
-- without any additional prompts.
--
-- Placement rationale:
--   - All three columns live on `users` rather than `firms`. Today every
--     self-serve sign-up lands in the shared SELF_SERVE_DEFAULT_FIRM_ID
--     firm (see auth.service.ts) — storing these on `firms` would mean
--     each fresh signup overwrites the previous user's values. Keeping
--     them per-user is also semantically fine: different lawyers in the
--     same firm legitimately have different enrolments, primary courts,
--     and practice areas. When real per-firm provisioning lands, these
--     can be promoted to `firms` (or kept where they are if per-user
--     remains the right grain).
-- =============================================================================

alter table users
  add column if not exists enrolment text,
  add column if not exists primary_court text,
  add column if not exists practice_areas text;
