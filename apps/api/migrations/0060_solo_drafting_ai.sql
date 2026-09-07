-- =============================================================================
-- 0060_solo_drafting_ai.sql
-- =============================================================================
-- Grants `drafting.ai` to the Solo Advocate system role.
--
-- Background: the feature gate resolves a user's abilities as role ∩ plan (see
-- permissions.service.ts `resolveFeatures` — a feature counts only when BOTH the
-- firm's plan AND the user's role grant it, absent an override). The Solo plan
-- has included `drafting.ai` in `plan_features` since 0009, but migration 0013
-- seeded the Solo Advocate role with only `drafting.basic / .templates / .clauses`
-- — never `drafting.ai`. Net effect: a solo advocate's plan unlocked AI drafting
-- but their role did not, so `role ∩ plan` evaluated to false and every AI
-- drafting route (POST /drafting/generate, /generate/stream, /agent/stream,
-- /pipeline, /auto, /extract-fields) returned 403 "missing 'drafting.ai'".
--
-- This backfills the role grant so the intersection evaluates true for solo
-- advocates on the Solo plan. Same shape as 0028_review_for_all_tiers.sql, which
-- fixed the identical role∩plan mismatch for the Review feature.
--
-- Scope: Solo Advocate only. The other roles that draft but lack drafting.ai
-- (Intern, Legal Secretary, Paralegal) are support roles where gating AI
-- drafting to fee-earners is a deliberate policy choice, so they are left as-is.
--
-- Idempotent: `on conflict do nothing` on the (role_id, feature_key) PK.
-- =============================================================================

do $$
declare
  r_solo uuid := (select id from roles where firm_id is null and is_system = true and name = 'Solo Advocate');
begin
  if r_solo is null then
    raise notice 'Solo Advocate role not found - skipping drafting.ai grant';
  else
    insert into role_features (role_id, feature_key, enabled)
    values (r_solo, 'drafting.ai', true)
    on conflict do nothing;
  end if;
end $$;
