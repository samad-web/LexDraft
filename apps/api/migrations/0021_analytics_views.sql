-- Materialized views for Firm-tier analytics.
--
-- The /api/analytics summary endpoint previously ran five aggregations
-- against the live `cases` and `invoices` tables every request - fine at
-- small scale, but it competes with write traffic and gets quadratically
-- worse as the firm's row count grows. These MVs move the heavy
-- aggregations off the hot path; the service reads firm-keyed rows and
-- pg-boss runs a daily REFRESH.
--
-- Refresh strategy: each MV has a `unique index` on its natural firm key
-- so `REFRESH MATERIALIZED VIEW CONCURRENTLY` is available - readers
-- never see a half-refreshed view, and writes against the underlying
-- tables don't block.
--
-- Staleness: up to 24h between scheduled refreshes. The on-demand
-- /api/admin/analytics/refresh endpoint (and the
-- `analytics.refresh` pg-boss job) lets operators trigger an immediate
-- refresh when a firm wants its dashboard to catch up sooner.

-- ---- Active matters per firm -----------------------------------------------
-- One row per firm with an Active case count.
create materialized view if not exists analytics_active_matters_mv as
  select
    firm_id,
    count(*)::int as active_count
  from cases
  where status = 'Active' and firm_id is not null
  group by firm_id;

create unique index if not exists analytics_active_matters_mv_firm_idx
  on analytics_active_matters_mv (firm_id);

-- ---- Stage breakdown of active matters -------------------------------------
-- One row per (firm, stage). The service flattens to an ordered list per firm.
create materialized view if not exists analytics_stages_mv as
  select
    firm_id,
    stage,
    count(*)::int as stage_count
  from cases
  where status = 'Active' and firm_id is not null
  group by firm_id, stage;

create unique index if not exists analytics_stages_mv_firm_stage_idx
  on analytics_stages_mv (firm_id, stage);

-- supports `where firm_id = $1 order by stage_count desc`
create index if not exists analytics_stages_mv_firm_count_idx
  on analytics_stages_mv (firm_id, stage_count desc);

-- ---- Outcome / win-rate per firm -------------------------------------------
-- One row per firm. `won` and `total` let the service compute win % without
-- another pass.
create materialized view if not exists analytics_outcomes_mv as
  select
    firm_id,
    count(*) filter (where outcome = 'Won')::int          as won,
    count(*) filter (where outcome is not null)::int      as total
  from cases
  where firm_id is not null
  group by firm_id;

create unique index if not exists analytics_outcomes_mv_firm_idx
  on analytics_outcomes_mv (firm_id);

-- ---- Monthly revenue per firm ----------------------------------------------
-- Sum of invoice amount_inr by (firm, year, month) over paid/pending/overdue
-- invoices. The service pivots this into the 12-month trailing window the
-- dashboard renders, AND derives YTD by summing rows where y = currentYear.
create materialized view if not exists analytics_monthly_revenue_mv as
  select
    firm_id,
    extract(year  from issued_date)::int as y,
    extract(month from issued_date)::int as m,
    coalesce(sum(amount_inr), 0)::bigint as total
  from invoices
  where firm_id is not null
    and status in ('paid', 'pending', 'overdue')
  group by firm_id, y, m;

create unique index if not exists analytics_monthly_revenue_mv_firm_ym_idx
  on analytics_monthly_revenue_mv (firm_id, y, m);

-- supports `where firm_id = $1 and (y, m) >= (...)` window scans
create index if not exists analytics_monthly_revenue_mv_firm_idx
  on analytics_monthly_revenue_mv (firm_id);
