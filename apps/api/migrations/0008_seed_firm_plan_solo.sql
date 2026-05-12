-- =============================================================================
-- LexDraft — align seed firm plan with auto-provisioned users
-- =============================================================================
-- Every user auto-provisioned by auth.service.signIn lands on the seed firm
-- (id = 00000000-0000-0000-0000-000000000001) with role = 'Solo Advocate'.
-- The plan_tier column was added in 0003_admin.sql with a default of 'Practice'
-- and may have been further changed via the admin console, leading to a
-- visible mismatch in the sidebar (role says "Solo Advocate" while the AI
-- quota reads "Unlimited" because the firm is on Firm tier).
--
-- This migration realigns the seed firm to plan_tier = 'Solo' so the role
-- label, the plan-aware dashboard dispatcher, and the AI-document quota all
-- agree. Real customer firms (different IDs) are unaffected.
-- =============================================================================

update firms
set plan_tier = 'Solo'
where id = '00000000-0000-0000-0000-000000000001';
