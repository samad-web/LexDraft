-- =============================================================================
-- 0028_review_for_all_tiers.sql
-- =============================================================================
-- Opens the contract-review feature to every plan tier and every system role.
--
-- Background: 0009 gated `review.approve` to Practice+ plans only. Solo plan
-- had `review.comment` but the routes / sidebar were gated on `review.approve`,
-- so Solo Advocate sign-ups never saw the Review tab. The application gate
-- moves down to `review.comment` (Solo-allowed); this migration backfills
-- `review.comment` for the three system roles that currently lack it
-- (Paralegal, Legal Secretary, Intern) so role ∩ plan still evaluates to
-- true for them on Solo / Practice / Firm.
--
-- Idempotent: `on conflict do nothing` on the (role_id, feature_key) PK.
-- =============================================================================

do $$
declare
  r_paral     uuid := (select id from roles where firm_id is null and is_system = true and name = 'Paralegal');
  r_secretary uuid := (select id from roles where firm_id is null and is_system = true and name = 'Legal Secretary');
  r_intern    uuid := (select id from roles where firm_id is null and is_system = true and name = 'Intern');
begin
  if r_paral is not null then
    insert into role_features (role_id, feature_key, enabled)
    values (r_paral, 'review.comment', true)
    on conflict do nothing;
  end if;
  if r_secretary is not null then
    insert into role_features (role_id, feature_key, enabled)
    values (r_secretary, 'review.comment', true)
    on conflict do nothing;
  end if;
  if r_intern is not null then
    insert into role_features (role_id, feature_key, enabled)
    values (r_intern, 'review.comment', true)
    on conflict do nothing;
  end if;
end $$;
