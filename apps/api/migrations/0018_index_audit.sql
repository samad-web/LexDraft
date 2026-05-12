-- Composite indexes for hot multi-column tenant-scoped queries.
--
-- The standalone (firm_id) indexes added in earlier migrations let Postgres
-- range-scan by tenant, but every dashboard / analytics query also filters
-- on a second column (status, stage, deadline, issued_date, …). With only
-- the leading-column index the planner had to filter the second predicate
-- row-by-row; the composites below let it index-only-scan.
--
-- All `create index if not exists` so the migration is idempotent and
-- safe to re-run. NOT `concurrently` — the in-app migration runner uses
-- single transactions today; promote to `concurrently` + standalone files
-- when we move to a managed runner that can run them out-of-transaction.

-- cases: dashboard filters by firm + active status; analytics groups by stage
create index if not exists cases_firm_status_idx on cases (firm_id, status);
create index if not exists cases_firm_stage_idx  on cases (firm_id, stage);

-- documents: register paginates newest-first per tenant
create index if not exists documents_firm_updated_idx on documents (firm_id, updated_at desc);

-- tasks: every list query is `where firm_id = $1` — currently a full scan
create index if not exists tasks_firm_idx        on tasks (firm_id);
create index if not exists tasks_firm_column_idx on tasks (firm_id, column_name);

-- limitations: upcoming-deadline lists scan by firm + deadline range
create index if not exists limitations_firm_deadline_idx on limitations (firm_id, deadline);

-- invoices: analytics scans by firm + issued_date for trailing-12-month rollup
create index if not exists invoices_firm_issued_idx on invoices (firm_id, issued_date);

-- hearings: today's list filters by status + date; tenant scope flows via
-- the join to cases.firm_id (no firm_id column on hearings itself).
create index if not exists hearings_status_date_idx on hearings (status, hearing_date);
