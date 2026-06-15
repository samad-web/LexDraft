-- =============================================================================
-- 0054_case_pipeline_graph.sql
-- =============================================================================
-- Refactors the case pipeline from a single linear stage array + currentIndex
-- (services/case-pipeline.service.ts STAGE_CATALOG, cases.stage) into a
-- per-case directed graph, and introduces first-class "applications" (interim
-- applications, appeals, execution, review, bail) as child entities.
--
--   1. case_applications  — many per matter. Each has a kind, free-text label
--      ("IA 412/2024"), an application type ("Stay", "Condonation"), filed/order
--      dates, and a status lifecycle (pending/allowed/dismissed/withdrawn/
--      disposed). `ext_ref` is reserved for a later eCourts sync pass to dedupe
--      against CaseOrder.order_id (interimOrder[] / finalOrder[]).
--   2. case_pipeline_nodes — the stages of one matter's graph. `status` carries
--      the progression (pending/active/done/skipped); several nodes may be
--      `active` at once when branches run in parallel. `pos_x`/`pos_y` persist
--      the builder layout. A node MAY point at an application so a branch can
--      read "IA filed → allowed / dismissed".
--   3. case_pipeline_edges — directed transitions between nodes, with an
--      optional `condition_label` ("if allowed", "on dismissal").
--
-- A backfill (bottom of file) materialises a linear graph for every existing
-- matter from the frozen STAGE_CATALOG snapshot + that firm's custom stages, so
-- nothing loses its pipeline. `cases.stage` is KEPT and continues to be the
-- denormalised "primary current stage" for list views and the legacy snapshot;
-- the service keeps it in sync on every node-status change.
--
-- Everything is additive. The backfill is guarded by `not exists` so the
-- migration is safe to re-run (the runner wraps each file in one transaction).
-- =============================================================================

-- ---- case_applications -------------------------------------------------------
do $$ begin
  create type application_kind as enum ('ia', 'appeal', 'execution', 'review', 'bail', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type application_status as enum ('pending', 'allowed', 'dismissed', 'withdrawn', 'disposed');
exception when duplicate_object then null; end $$;

create table if not exists case_applications (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references cases(id) on delete cascade,
  firm_id           uuid not null references firms(id) on delete cascade,
  kind              application_kind not null default 'ia',
  -- Free-text registry number / label, e.g. "IA 412/2024", "Crl.A 88/2023".
  label             text,
  -- Nature of the application, e.g. "Stay", "Condonation of delay", "Amendment".
  app_type          text,
  filed_on          date,
  status            application_status not null default 'pending',
  -- Date of the order disposing of the application (null while pending).
  order_on          date,
  notes             text,
  position          integer not null default 0,
  source            text not null default 'manual' check (source in ('manual', 'ecourts')),
  -- Clients see applications in the portal by default; advocates can hide a row.
  visible_to_portal boolean not null default true,
  -- Dedupe key for a future eCourts sync (CaseOrder.order_id). Nullable for
  -- manual rows; unique-per-case when present so re-sync is idempotent.
  ext_ref           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists case_applications_case_idx on case_applications (case_id, position);
create index if not exists case_applications_firm_idx on case_applications (firm_id);
create unique index if not exists case_applications_extref_uniq
  on case_applications (case_id, ext_ref) where ext_ref is not null;

-- ---- case_pipeline_nodes -----------------------------------------------------
do $$ begin
  create type pipeline_node_status as enum ('pending', 'active', 'done', 'skipped');
exception when duplicate_object then null; end $$;

create table if not exists case_pipeline_nodes (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references cases(id) on delete cascade,
  firm_id         uuid not null references firms(id) on delete cascade,
  label           text not null,
  status          pipeline_node_status not null default 'pending',
  pos_x           double precision not null default 0,
  pos_y           double precision not null default 0,
  -- Seed ordinal; tiebreak for layout + lets the service pick a sensible
  -- "primary stage" when several nodes are active.
  position        integer not null default 0,
  -- Optional link to an application (on delete set null keeps the branch).
  application_id  uuid references case_applications(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists case_pipeline_nodes_case_idx on case_pipeline_nodes (case_id, position);
create index if not exists case_pipeline_nodes_firm_idx on case_pipeline_nodes (firm_id);

-- ---- case_pipeline_edges -----------------------------------------------------
create table if not exists case_pipeline_edges (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references cases(id) on delete cascade,
  firm_id         uuid not null references firms(id) on delete cascade,
  from_node_id    uuid not null references case_pipeline_nodes(id) on delete cascade,
  to_node_id      uuid not null references case_pipeline_nodes(id) on delete cascade,
  condition_label text,
  created_at      timestamptz not null default now()
);
create index if not exists case_pipeline_edges_case_idx on case_pipeline_edges (case_id);
create unique index if not exists case_pipeline_edges_uniq
  on case_pipeline_edges (from_node_id, to_node_id);

-- ---- backfill ----------------------------------------------------------------
-- Materialise a linear graph for every existing matter. The catalog below is a
-- frozen point-in-time copy of STAGE_CATALOG + kindForType (case-pipeline.
-- service.ts as of 0054) — migrations are historical artifacts and intentionally
-- embed the snapshot rather than reading live TypeScript. Custom firm stages are
-- appended (deduped case-insensitively) exactly as snapshotFor() merges them.
do $$
declare
  c          record;
  kind_key   text;
  base       text[];
  custom     text[];
  merged     text[];
  s          text;
  ord        int;
  active_idx int;
  nid        uuid;
  prev_nid   uuid;
begin
  for c in
    select id, firm_id, type, stage from cases where firm_id is not null
  loop
    -- Idempotency: skip matters that already have a graph.
    if exists (select 1 from case_pipeline_nodes n where n.case_id = c.id) then
      continue;
    end if;

    kind_key := case
      when lower(coalesce(c.type, '')) like '%criminal%' then 'criminal'
      when lower(coalesce(c.type, '')) like '%writ%'
        or lower(coalesce(c.type, '')) like '%pil%'
        or lower(coalesce(c.type, '')) like '%slp%' then 'writ'
      when lower(coalesce(c.type, '')) like '%consumer%' then 'consumer'
      when lower(coalesce(c.type, '')) like '%civil%'
        or lower(coalesce(c.type, '')) like '%suit%'
        or lower(coalesce(c.type, '')) like '%arbitration%' then 'civil'
      else 'default'
    end;

    base := case kind_key
      when 'criminal' then array['FIR','Chargesheet','Cognizance','Framing of Charges','Evidence','Arguments','Judgment','Appeal']
      when 'writ'     then array['Filing','Service','Counter','Rejoinder','IA','Arguments','Judgment','SLP']
      when 'consumer' then array['Filing','Notice','Reply','IA','Evidence','Arguments','Order','Appeal']
      when 'civil'    then array['Filing','Summons','Written Statement','Issues','IA','Evidence','Arguments','Judgment','Appeal']
      else                 array['Filing','Summons','Written Statement','Issues','IA','Evidence','Arguments','Judgment','Appeal']
    end;

    select array_agg(stage_name order by position asc, created_at asc)
      into custom
      from firm_custom_case_stages
     where firm_id = c.firm_id
       and (kind = kind_key or kind = 'all');

    merged := base;
    if custom is not null then
      foreach s in array custom loop
        if not exists (select 1 from unnest(merged) m where lower(m) = lower(s)) then
          merged := array_append(merged, s);
        end if;
      end loop;
    end if;

    -- Exact match against cases.stage, mirroring snapshotFor()'s indexOf.
    active_idx := array_position(merged, c.stage);

    prev_nid := null;
    ord := 0;
    foreach s in array merged loop
      insert into case_pipeline_nodes (case_id, firm_id, label, status, pos_x, pos_y, position)
      values (
        c.id, c.firm_id, s,
        (case
          when active_idx is null      then 'pending'
          when (ord + 1) < active_idx  then 'done'
          when (ord + 1) = active_idx  then 'active'
          else 'pending'
        end)::pipeline_node_status,
        ord * 220, 0, ord
      )
      returning id into nid;

      if prev_nid is not null then
        insert into case_pipeline_edges (case_id, firm_id, from_node_id, to_node_id)
        values (c.id, c.firm_id, prev_nid, nid);
      end if;

      prev_nid := nid;
      ord := ord + 1;
    end loop;
  end loop;
end $$;
