-- =============================================================================
-- 0104 Pricing v2 phase A (build-docs/features/pricing-v2.md)
--
-- 1. ai_generations.source_key: one row per finished intake draft, so editing
--    or re-rendering the same draft never counts twice (unique where set).
-- 2. Monthly draft limits per advocate: Solo 50, Practice (shown as "Chamber")
--    40, Firm 1000 unchanged.
-- 3. Chamber starts at 2 seats: firm_seat_floor('Practice') 8 -> 2. The floor
--    only ever raises seats, so firms that already have 8 keep 8.
--
-- Additive and idempotent: safe to re-run. No rows are deleted.
-- =============================================================================

alter table ai_generations add column if not exists source_key text;

create unique index if not exists ai_generations_source_key_uq
  on ai_generations (source_key) where source_key is not null;

insert into plan_ai_caps (plan_tier, monthly_cap) values
  ('Solo', 50), ('Practice', 40), ('Firm', 1000)
on conflict (plan_tier) do update
  set monthly_cap = excluded.monthly_cap, updated_at = now();

create or replace function firm_seat_floor(p_tier firm_plan_tier)
returns integer
language sql immutable as $$
  select case p_tier
    when 'Solo'     then 1
    when 'Practice' then 2
    when 'Firm'     then 9999
    else 1
  end
$$;
