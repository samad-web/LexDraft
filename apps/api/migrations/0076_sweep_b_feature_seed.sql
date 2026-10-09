-- =============================================================================
-- 0076_sweep_b_feature_seed.sql
-- =============================================================================
-- "Sweep B" added three cross-tier features in code (routes + the
-- permissions.service.ts SOLO_FEATURES/demo-mode fallback comment calls them
-- out explicitly as "Sweep B cross-tier features available even at Solo"):
--
--   - tools.calculators   (calculators.routes.ts: court fee / stamp duty /
--                          vakalatnama - "Solo/Practice/Firm tiers all
--                          receive it by default")
--   - caseload.health     (caseload-health.routes.ts: SoloDashboard widget)
--   - exports.financial   (exports.routes.ts: invoices/expenses CSV export)
--
-- None of these ever got a catalog/plan/role seed migration - the demo-mode
-- (no DATABASE_URL) fallback in permissions.service.ts included them, which
-- masked the gap in local dev, but the real DB-backed resolver had zero rows
-- for all three keys in `features`, `plan_features`, and `role_features`.
-- Every tier (Solo/Practice/Firm) was affected, not just Solo.
--
-- This migration brings the DB catalog in line with the code's already-
-- documented intent: all three features are granted to every plan tier and
-- to every system role that already receives the analogous Solo-tier grants
-- (i.e. every role except the read/comment-limited Legal Secretary and
-- Intern, and the drafting-only Paralegal - mirroring demoFallbackFor()'s
-- role split in permissions.service.ts).
--
-- Idempotent.
-- =============================================================================

-- ---- features catalog ------------------------------------------------------

insert into features (key, name, description, domain, default_baseline) values
  ('tools.calculators', 'Legal calculators',        'Court fee, stamp duty, and vakalatnama calculators.', 'drafting', false),
  ('caseload.health',   'Caseload health widget',   'See burnout-risk signals across open matters, limitations, and hearings.', 'reports', false),
  ('exports.financial', 'Export financial records', 'Export invoices and expenses as CSV for GST/Tally compliance.', 'reports', false)
on conflict (key) do nothing;

-- ---- plan_features (Layer 1) ------------------------------------------------
-- Cross-tier by design: Solo, Practice, and Firm all get all three.

insert into plan_features (plan_tier, feature_key, enabled)
select p.tier, f.key, true
from (values ('Solo'::firm_plan_tier), ('Practice'::firm_plan_tier), ('Firm'::firm_plan_tier)) as p(tier)
cross join features f
where f.key in ('tools.calculators', 'caseload.health', 'exports.financial')
on conflict do nothing;

-- ---- role_features (Layer 2) ------------------------------------------------
-- Grant to every system role that already carries the Solo-plan baseline
-- grants (matches demoFallbackFor()'s SOLO_FEATURES / PRACTICE_LEAD_FEATURES /
-- FIRM_ADMIN_FEATURES split): Solo Advocate, Practice Group Lead, Partner,
-- Senior Associate, Associate, and Firm Admin. Paralegal, Legal Secretary,
-- and Intern are intentionally excluded - they don't get these keys in the
-- demo-mode fallback either.

insert into role_features (role_id, feature_key, enabled)
select r.id, f.key, true
from roles r
cross join features f
where r.firm_id is null
  and r.is_system = true
  and r.name in (
    'Solo Advocate', 'Practice Group Lead', 'Partner',
    'Senior Associate', 'Associate', 'Firm Admin'
  )
  and f.key in ('tools.calculators', 'caseload.health', 'exports.financial')
on conflict do nothing;
