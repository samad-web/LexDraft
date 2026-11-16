-- Associates (Practice tier) gets the firm dashboard, as its plan card promises
-- (owner, 2026-11-16). Role grants are unchanged: Firm Admin, Partner and
-- Practice Group Lead see it; Associates and Munshi do not. Additive.
insert into plan_features (plan_tier, feature_key, enabled)
values ('Practice'::firm_plan_tier, 'firm.dashboard.view', true)
on conflict (plan_tier, feature_key) do update set enabled = true;
