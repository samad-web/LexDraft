-- Pricing v4 plan catalogue (features/pricing-v4.md). Additive: old plan ids
-- (solo / practice / firm) stay valid so history rows keep rendering.

-- 1. New plan ids on the firm.
alter table firms drop constraint if exists firms_selected_plan_check;
alter table firms add constraint firms_selected_plan_check check (selected_plan in
  ('free', 'sanad', 'vakalat', 'brief', 'associates', 'partners', 'solo', 'practice', 'firm'));

-- 2. Munshi (clerk) seats bought, beside advocate seats (firms.seats).
alter table firms add column if not exists munshi_seats integer not null default 0
  check (munshi_seats between 0 and 50);

-- 3. Free launch promise (lib/free-plan.ts) kept only for accounts that already
--    have it: new sign-ups pick a paid plan. A free-launch firm that later pays
--    and cancels goes back to free until 1 Jun 2027.
alter table firms add column if not exists free_launch boolean not null default false;
update firms set free_launch = true where coalesce(free_plan, false) and not free_launch;

-- 4. Razorpay plans: v4 ids, and the Munshi count is part of what was bought.
alter table razorpay_plans drop constraint if exists razorpay_plans_plan_check;
alter table razorpay_plans add constraint razorpay_plans_plan_check check (plan in
  ('sanad', 'vakalat', 'brief', 'associates', 'solo', 'practice'));
alter table razorpay_plans add column if not exists munshi_seats integer not null default 0
  check (munshi_seats between 0 and 50);
alter table razorpay_plans drop constraint if exists razorpay_plans_plan_cycle_seats_amount_paise_key;
create unique index if not exists razorpay_plans_unique_price
  on razorpay_plans (plan, cycle, seats, munshi_seats, amount_paise);

-- 5. Invoices name the Munshi seats bought.
alter table subscription_invoices add column if not exists munshi_seats integer not null default 0
  check (munshi_seats >= 0);
