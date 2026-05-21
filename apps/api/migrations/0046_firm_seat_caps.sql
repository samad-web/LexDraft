-- =============================================================================
-- LexDraft - Firm seat caps tied to plan tier
-- =============================================================================
-- `firms.seats` was defaulted to 1 in migration 0001 and never auto-aligned
-- with `plan_tier`, so Practice firms could be sitting at 1 seat (blocking
-- their invite flow) while Firm-tier firms could be unconfigured too. This
-- migration:
--
--   1. Defines a single source of truth for tier seat floors:
--        Solo     = 1
--        Practice = 8
--        Firm     = 9999  (effectively unlimited; superadmin can override)
--
--   2. Backfills every existing firm so seats >= floor(plan_tier).
--      Never reduces an admin-set higher value.
--
--   3. Installs a BEFORE INSERT/UPDATE trigger so:
--        - INSERT: seats := greatest(seats, floor(plan_tier))
--        - UPDATE when plan_tier changes: seats := greatest(seats, floor(new))
--      Bare `update firms set seats = N` is left alone so superadmin can
--      adjust a Firm tenant's seats freely above the floor.
--
-- The invitation service additionally rejects new invites when
-- (active users + pending invites) >= seats, so the cap is enforced at the
-- business layer too. See apps/api/src/services/invitations.service.ts.
--
-- Idempotent.
-- =============================================================================

create or replace function firm_seat_floor(p_tier firm_plan_tier)
returns integer
language sql immutable as $$
  select case p_tier
    when 'Solo'     then 1
    when 'Practice' then 8
    when 'Firm'     then 9999
    else 1
  end
$$;

-- Backfill: ensure every firm's seats >= floor(plan_tier). Never reduces.
update firms
   set seats = firm_seat_floor(plan_tier)
 where seats < firm_seat_floor(plan_tier);

create or replace function set_firm_seats_from_plan()
returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.seats := greatest(coalesce(new.seats, 0), firm_seat_floor(new.plan_tier));
  elsif tg_op = 'UPDATE' and new.plan_tier is distinct from old.plan_tier then
    new.seats := greatest(new.seats, firm_seat_floor(new.plan_tier));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_firm_seats_from_plan on firms;
create trigger trg_firm_seats_from_plan
  before insert or update of plan_tier, seats on firms
  for each row execute function set_firm_seats_from_plan();
