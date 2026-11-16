-- Pricing v5 (features/pricing-v5.md, owner 2026-11-16). Additive: no column or
-- row is dropped, old plan ids stay valid so old rows and invoices keep
-- rendering. Take a backup (pg_dump of firms, billing_events, credit_grants,
-- plan_features, role_features) before running on a live database.

-- 1. New plan ids beside the old ones.
alter table firms drop constraint if exists firms_selected_plan_check;
alter table firms add constraint firms_selected_plan_check check (selected_plan in
  ('free', 'advocate', 'chambers', 'law_firm', 'enterprise',
   'sanad', 'vakalat', 'brief', 'associates', 'partners', 'solo', 'practice', 'firm'));

-- 2. Enterprise quote: AI credits a month set by the superadmin (null = the plan's own).
alter table firms add column if not exists credit_allowance numeric(9,1)
  check (credit_allowance is null or credit_allowance >= 0);

-- 2b. The seat floor trigger (0046/0104) raised a firm to 9999 seats whenever
--     its tier became Firm, which would make the Firm plan (8 advocates)
--     unlimited. The v5 floor for the Firm tier is 8; an Enterprise firm gets
--     its seat count from the superadmin (a bare seats update is never
--     floored down). Existing rows are not changed by this.
create or replace function firm_seat_floor(p_tier firm_plan_tier)
returns integer
language sql immutable as $$
  select case p_tier
    when 'Solo'     then 1
    when 'Practice' then 2
    when 'Firm'     then 8
    else 1
  end
$$;

-- 3. The exact amount charged (₹824.82 does not fit billing_events.amount_inr).
alter table billing_events add column if not exists amount_paise bigint;

-- 4. Analytics on every plan (owner): the Analytics page (analytics.firm, served
--    by /analytics which needs reports.activity) for the Solo and Practice
--    tiers, and for the Solo Advocate role that owns an Advocate account.
--    Firm Admin (Managing Partner) and Partner already have both. Practice
--    Group Lead stays without it (0013), and Munshi never gets it.
insert into plan_features (plan_tier, feature_key, enabled) values
  ('Solo'::firm_plan_tier,     'analytics.firm',   true),
  ('Solo'::firm_plan_tier,     'reports.activity', true),
  ('Practice'::firm_plan_tier, 'analytics.firm',   true)
on conflict (plan_tier, feature_key) do update set enabled = true;

insert into role_features (role_id, feature_key, enabled)
select r.id, k.key, true
from roles r cross join (values ('analytics.firm'), ('reports.activity')) as k(key)
where r.firm_id is null and r.is_system and r.name = 'Solo Advocate'
on conflict (role_id, feature_key) do update set enabled = true;

-- 5. Record of every firm moved from a v4 plan (audit + manual rollback).
create table if not exists pricing_v5_moves (
  firm_id     uuid primary key references firms(id) on delete cascade,
  old_plan    text not null,
  old_seats   integer,
  old_tier    firm_plan_tier,
  old_mrr_inr integer,
  moved_at    timestamptz not null default now()
);

-- 6. A paying firm on Brief would get fewer monthly credits (200 -> 150): stop
--    and let the owner decide (e.g. an admin goodwill grant) before moving it.
do $$
begin
  if exists (
    select 1 from firms
    where selected_plan = 'brief' and plan_status = 'active'
      and not coalesce(free_plan, false) and renews_at > now()
  ) then
    raise exception 'pricing v5: a paying Brief firm would lose monthly credits; decide before migrating';
  end if;
end $$;

-- 7. Move every v4 firm now (owner). Paid-until (renews_at), billing cycle,
--    plan status and Munshi seats are untouched; MRR becomes ex-GST. Only v4
--    ids are touched, so running this again changes nothing.
insert into pricing_v5_moves (firm_id, old_plan, old_seats, old_tier, old_mrr_inr)
select id, selected_plan, seats, plan_tier, mrr_inr
from firms
where selected_plan in ('sanad', 'vakalat', 'brief', 'associates', 'partners')
on conflict (firm_id) do nothing;

update firms set
  selected_plan = case
    when selected_plan in ('sanad', 'vakalat', 'brief') then 'advocate'
    when selected_plan = 'associates' and coalesce(seats, 2) <= 3 then 'chambers'
    when selected_plan = 'associates' then 'law_firm'
    else 'enterprise' end,
  seats = case
    when selected_plan in ('sanad', 'vakalat', 'brief') then 1
    when selected_plan = 'associates' and coalesce(seats, 2) <= 3 then 3
    when selected_plan = 'associates' then 8
    else seats end,
  plan_tier = case
    when selected_plan in ('sanad', 'vakalat', 'brief') then 'Solo'
    when selected_plan = 'associates' and coalesce(seats, 2) <= 3 then 'Practice'
    else 'Firm' end::firm_plan_tier,
  mrr_inr = round(coalesce(mrr_inr, 0) / 1.18)::int
where selected_plan in ('sanad', 'vakalat', 'brief', 'associates', 'partners');
