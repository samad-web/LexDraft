-- =============================================================================
-- LexDraft - Grant `drafting.ai` to the Solo plan
-- =============================================================================
-- Migration 0009 omitted `drafting.ai` from Solo's `plan_features` list, which
-- collapsed the resolver to false and hid the Draft sidebar link. Per
-- PRICING_AND_TIERS.md §3.2 Solo ships with 50 AI drafts/month - the gate
-- should be open; metering enforces the cap (apps/api/src/routes/me.routes.ts
-- already handles per-month quota for Solo).
--
-- Idempotent.
-- =============================================================================

insert into plan_features (plan_tier, feature_key, enabled)
select 'Solo'::firm_plan_tier, 'drafting.ai', true
where exists (select 1 from features where key = 'drafting.ai')
on conflict do nothing;
