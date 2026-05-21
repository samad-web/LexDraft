-- =============================================================================
-- 0052_drop_plan_title_report_caps.sql
-- =============================================================================
-- The per-plan Solo title-report cap was retired in favour of the shared AI
-- quota (plan_ai_caps + ai_generations) that already governs document and
-- contract-review generation. Drop the now-orphan table.
--
-- Title report creation is now gated only by:
--   1. The feature flag `title_report.use` (BASELINE in 0050).
--   2. The shared AI generation cap recorded in `ai_generations`, asserted
--      via aiQuotaService.assertCanGenerate in titleReportsService.create.
--   3. The role matrix in title-reports.service.ts (advocate / paralegal yes;
--      legal-secretary / intern no).
--
-- The service's `quotaStatus()` function now reports an "unlimited" cap;
-- the GET /api/title-reports/quota route + useTitleReportQuota hook remain
-- for forward-compat but should not be relied on for gating.
-- =============================================================================

drop table if exists plan_title_report_caps;
