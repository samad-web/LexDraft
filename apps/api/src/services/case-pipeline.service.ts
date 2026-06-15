/**
 * Case-pipeline service.
 *
 * Owns the canonical stage catalog per matter type, the transition path
 * (with audit logging), and the unified timeline that combines stage
 * transitions, hearings, documents, and case notes into one chronological
 * stream.
 *
 * Transition policy is lenient by design — any stage can move to any other
 * stage. The `case_stage_events` audit row is the contract; nothing here
 * blocks a "Filing → Appeal" jump because real-world matters do skip steps
 * (settled at mediation, transferred between courts, etc.). The audit
 * trail lets a partner reconstruct what happened.
 */

import type {
  CasePipelineGraph,
  PipelineNode,
  PipelineEdge,
  PipelineNodeStatus,
  ApplicationKind,
  ApplicationStatus,
} from '@lexdraft/types';
import { db } from '../db/client';

type DbHandle = NonNullable<ReturnType<typeof db>>;

export type PipelineKind = 'civil' | 'criminal' | 'consumer' | 'writ' | 'default';

// IA = Interlocutory Application. Surfaced as a stage on the civil / writ /
// consumer / default paths so practices can record when a matter is parked
// pending an interim application. Criminal matters use bail / IA-style
// applications differently, so we don't insert it into that catalog by
// default — firms can still add it via the per-firm `firm_custom_case_stages`
// table below.
const STAGE_CATALOG: Record<PipelineKind, readonly string[]> = {
  civil: ['Filing', 'Summons', 'Written Statement', 'Issues', 'IA', 'Evidence', 'Arguments', 'Judgment', 'Appeal'],
  criminal: ['FIR', 'Chargesheet', 'Cognizance', 'Framing of Charges', 'Evidence', 'Arguments', 'Judgment', 'Appeal'],
  consumer: ['Filing', 'Notice', 'Reply', 'IA', 'Evidence', 'Arguments', 'Order', 'Appeal'],
  writ: ['Filing', 'Service', 'Counter', 'Rejoinder', 'IA', 'Arguments', 'Judgment', 'SLP'],
  default: ['Filing', 'Summons', 'Written Statement', 'Issues', 'IA', 'Evidence', 'Arguments', 'Judgment', 'Appeal'],
};

export interface PipelineSnapshot {
  kind: PipelineKind;
  stages: string[];
  /** Index of the current stage in `stages`; -1 if the stored stage doesn't
   *  match any catalog entry (free-text drift from earlier migrations). */
  currentIndex: number;
}

export type TimelineEventKind = 'stage' | 'hearing' | 'document' | 'note' | 'application';

export interface TimelineEvent {
  id: string;
  at: string;
  kind: TimelineEventKind;
  title: string;
  body: string;
  actorName?: string;
  visibleToPortal: boolean;
}

/** Map a free-text `cases.type` value to a catalog key. Soft match — order
 *  matters here because "Criminal Appeal" must beat "Appeal" and "PIL Writ"
 *  must beat "Writ". */
export function kindForType(rawType: string | null | undefined): PipelineKind {
  const t = (rawType ?? '').toLowerCase();
  if (!t) return 'default';
  if (t.includes('criminal')) return 'criminal';
  if (t.includes('writ') || t.includes('pil') || t.includes('slp')) return 'writ';
  if (t.includes('consumer')) return 'consumer';
  if (t.includes('civil') || t.includes('suit') || t.includes('arbitration')) return 'civil';
  return 'default';
}

export function stagesFor(kind: PipelineKind): readonly string[] {
  return STAGE_CATALOG[kind];
}

/**
 * Build a pipeline snapshot. `extraStages` is whatever the caller pre-fetched
 * from `firm_custom_case_stages` for this firm (and either the matter's kind
 * or `'all'`) — when provided, those stages are appended to the canonical
 * catalog so the stepper renders them inline. Duplicates are skipped
 * case-insensitively because the unique index in 0050 already enforces
 * uniqueness per firm.
 */
export function snapshotFor(
  type: string | null | undefined,
  currentStage: string | null | undefined,
  extraStages: readonly string[] = [],
): PipelineSnapshot {
  const kind = kindForType(type);
  const base = [...STAGE_CATALOG[kind]];
  const seen = new Set(base.map((s) => s.toLowerCase()));
  for (const extra of extraStages) {
    const k = extra.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    base.push(extra);
  }
  const idx = currentStage ? base.indexOf(currentStage) : -1;
  return { kind, stages: base, currentIndex: idx };
}

/**
 * Per-firm custom stages. Reads any rows in `firm_custom_case_stages` where
 * `kind` matches the matter's pipeline kind OR is `'all'` (firm-wide
 * additions). Returns an empty list outside the SQL path so demo mode and
 * tests still get a stable catalog.
 */
export async function customStagesForFirm(
  firmId: string | null | undefined,
  kind: PipelineKind,
): Promise<string[]> {
  if (!firmId) return [];
  const sql = db();
  if (!sql) return [];
  const rows = await sql<Array<{ stage_name: string }>>`
    select stage_name
    from firm_custom_case_stages
    where firm_id = ${firmId}::uuid
      and (kind = ${kind} or kind = 'all')
    order by position asc, created_at asc
  `;
  return rows.map((r) => r.stage_name);
}

export interface FirmCustomStage {
  id: string;
  kind: PipelineKind | 'all';
  stageName: string;
  position: number;
  createdAt: string;
}

interface CustomStageRow {
  id: string;
  kind: string;
  stage_name: string;
  position: number;
  created_at: string | Date;
}

function fromCustomStageRow(r: CustomStageRow): FirmCustomStage {
  return {
    id: r.id,
    kind: (r.kind as FirmCustomStage['kind']) ?? 'all',
    stageName: r.stage_name,
    position: r.position,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

export const firmStageAdmin = {
  async list(firmId: string): Promise<FirmCustomStage[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<CustomStageRow[]>`
      select id, kind, stage_name, position, created_at
      from firm_custom_case_stages
      where firm_id = ${firmId}::uuid
      order by kind asc, position asc, created_at asc
    `;
    return rows.map(fromCustomStageRow);
  },

  async create(input: {
    firmId: string;
    kind: PipelineKind | 'all';
    stageName: string;
    position?: number;
    createdBy?: string | null;
  }): Promise<FirmCustomStage> {
    const sql = db();
    if (!sql) throw Object.assign(new Error('Database not configured'), { status: 500 });
    const trimmed = input.stageName.trim();
    if (!trimmed) throw Object.assign(new Error('Stage name required'), { status: 400 });
    const rows = await sql<CustomStageRow[]>`
      insert into firm_custom_case_stages
        (firm_id, kind, stage_name, position, created_by)
      values
        (${input.firmId}::uuid, ${input.kind}, ${trimmed},
         ${input.position ?? 1000}, ${input.createdBy ?? null})
      on conflict (firm_id, kind, lower(stage_name)) do update
        set stage_name = excluded.stage_name
      returning id, kind, stage_name, position, created_at
    `;
    return fromCustomStageRow(rows[0]!);
  },

  async remove(firmId: string, id: string): Promise<boolean> {
    const sql = db();
    if (!sql) return false;
    const rows = await sql<Array<{ id: string }>>`
      delete from firm_custom_case_stages
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
      returning id
    `;
    return rows.length > 0;
  },
};

// =============================================================================
// Per-case pipeline graph (migration 0054)
//
// Each matter owns its own directed graph of stage nodes + edges, seeded at
// creation from the per-type template (STAGE_CATALOG + firm custom stages) and
// then freely editable on that case alone. `status` carries the progression;
// several nodes may be `active` at once when branches run in parallel.
// `cases.stage` is kept in sync as the denormalised "primary current stage".
// =============================================================================

interface NodeRow {
  id: string;
  case_id: string;
  label: string;
  status: PipelineNodeStatus;
  pos_x: number;
  pos_y: number;
  position: number;
  application_id: string | null;
}

interface EdgeRow {
  id: string;
  case_id: string;
  from_node_id: string;
  to_node_id: string;
  condition_label: string | null;
}

function nodeFromRow(r: NodeRow): PipelineNode {
  return {
    id: r.id,
    caseId: r.case_id,
    label: r.label,
    status: r.status,
    x: r.pos_x,
    y: r.pos_y,
    position: r.position,
    applicationId: r.application_id,
  };
}

function edgeFromRow(r: EdgeRow): PipelineEdge {
  return {
    id: r.id,
    caseId: r.case_id,
    fromNodeId: r.from_node_id,
    toNodeId: r.to_node_id,
    conditionLabel: r.condition_label,
  };
}

/** Build the ordered template stage list for a matter — STAGE_CATALOG for the
 *  inferred kind plus the firm's custom stages, deduped case-insensitively.
 *  This is the same merge `snapshotFor()` does, reused as the graph seed. */
async function buildTemplateStages(
  firmId: string | null | undefined,
  type: string | null | undefined,
): Promise<string[]> {
  const kind = kindForType(type);
  const base = [...STAGE_CATALOG[kind]];
  const extras = await customStagesForFirm(firmId, kind);
  const seen = new Set(base.map((s) => s.toLowerCase()));
  for (const extra of extras) {
    const k = extra.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    base.push(extra);
  }
  return base;
}

/** Materialise a linear graph from the template. Called at case creation and
 *  as a lazy fallback by `getGraph` for any matter that has no nodes yet
 *  (e.g. created via a path that skipped instantiation). Accepts a tx handle
 *  so it can fold into a create transaction. */
export async function instantiateGraph(
  caseId: string,
  firmId: string,
  type: string | null | undefined,
  currentStage: string | null | undefined,
  tx?: DbHandle,
): Promise<void> {
  const exec = tx ?? db();
  if (!exec) return;
  const stages = await buildTemplateStages(firmId, type);
  if (stages.length === 0) return;
  const activeIdx = currentStage ? stages.indexOf(currentStage) : -1;

  let prevId: string | null = null;
  let ord = 0;
  for (const label of stages) {
    const status: PipelineNodeStatus =
      activeIdx === -1 ? 'pending'
      : ord < activeIdx ? 'done'
      : ord === activeIdx ? 'active'
      : 'pending';
    const [node] = await exec<Array<{ id: string }>>`
      insert into case_pipeline_nodes
        (case_id, firm_id, label, status, pos_x, pos_y, position)
      values
        (${caseId}::uuid, ${firmId}::uuid, ${label}, ${status}::pipeline_node_status,
         ${ord * 220}, 0, ${ord})
      returning id
    `;
    if (prevId && node) {
      await exec`
        insert into case_pipeline_edges (case_id, firm_id, from_node_id, to_node_id)
        values (${caseId}::uuid, ${firmId}::uuid, ${prevId}::uuid, ${node.id}::uuid)
        on conflict (from_node_id, to_node_id) do nothing
      `;
    }
    prevId = node?.id ?? prevId;
    ord += 1;
  }
}

export interface NewNodeInput {
  label: string;
  x: number;
  y: number;
  applicationId?: string | null;
}

export interface NodePatch {
  label?: string;
  x?: number;
  y?: number;
  applicationId?: string | null;
}

export interface NewEdgeInput {
  fromNodeId: string;
  toNodeId: string;
  conditionLabel?: string | null;
}

export interface SetNodeStatusInput {
  nodeId: string;
  firmId: string;
  status: PipelineNodeStatus;
  actor: { id: string | null; name: string | null };
  note?: string | null;
  visibleToPortal?: boolean;
}

export const pipelineGraph = {
  /** Read the full graph for a matter. Lazily instantiates from the template
   *  when the matter has no nodes yet (backfill-missed / freshly created via a
   *  path that skipped instantiation). Tenant-scoped via cases.firm_id. */
  async get(caseId: string, firmId: string): Promise<CasePipelineGraph> {
    const sql = db();
    if (!sql) return { nodes: [], edges: [] };

    const [own] = await sql<Array<{ id: string; type: string; stage: string }>>`
      select id, type, stage from cases
      where id::text = ${caseId} and firm_id = ${firmId}::uuid
      limit 1
    `;
    if (!own) return { nodes: [], edges: [] };

    let nodes = await sql<NodeRow[]>`
      select id, case_id, label, status, pos_x, pos_y, position, application_id
      from case_pipeline_nodes
      where case_id::text = ${caseId}
      order by position, created_at
    `;
    if (nodes.length === 0) {
      await instantiateGraph(caseId, firmId, own.type, own.stage);
      nodes = await sql<NodeRow[]>`
        select id, case_id, label, status, pos_x, pos_y, position, application_id
        from case_pipeline_nodes
        where case_id::text = ${caseId}
        order by position, created_at
      `;
    }

    const edges = await sql<EdgeRow[]>`
      select id, case_id, from_node_id, to_node_id, condition_label
      from case_pipeline_edges
      where case_id::text = ${caseId}
    `;

    return { nodes: nodes.map(nodeFromRow), edges: edges.map(edgeFromRow) };
  },

  /** Add a node. Position appended after the current max; coordinates come
   *  from the builder. Scoped + firm_id derived via insert-from-select. */
  async addNode(caseId: string, firmId: string, input: NewNodeInput): Promise<PipelineNode | null> {
    const sql = db();
    if (!sql) return null;
    const rows = await sql<NodeRow[]>`
      insert into case_pipeline_nodes
        (case_id, firm_id, label, status, pos_x, pos_y, position, application_id)
      select c.id, c.firm_id, ${input.label}, 'pending'::pipeline_node_status,
             ${input.x}, ${input.y},
             coalesce((select max(position) + 1 from case_pipeline_nodes where case_id = c.id), 0),
             ${input.applicationId ?? null}
      from cases c
      where c.id::text = ${caseId} and c.firm_id = ${firmId}::uuid
      returning id, case_id, label, status, pos_x, pos_y, position, application_id
    `;
    return rows[0] ? nodeFromRow(rows[0]) : null;
  },

  /** Patch a node's label / position / application link. Status changes go
   *  through `setStatus` so they carry an audit row. */
  async updateNode(nodeId: string, firmId: string, patch: NodePatch): Promise<PipelineNode | null> {
    const sql = db();
    if (!sql) return null;
    const rows = await sql<NodeRow[]>`
      update case_pipeline_nodes set
        label          = coalesce(${patch.label ?? null}, label),
        pos_x          = coalesce(${patch.x ?? null}, pos_x),
        pos_y          = coalesce(${patch.y ?? null}, pos_y),
        application_id = ${patch.applicationId !== undefined ? sql`${patch.applicationId}::uuid` : sql`application_id`},
        updated_at     = now()
      where id::text = ${nodeId} and firm_id = ${firmId}::uuid
      returning id, case_id, label, status, pos_x, pos_y, position, application_id
    `;
    return rows[0] ? nodeFromRow(rows[0]) : null;
  },

  async deleteNode(nodeId: string, firmId: string): Promise<boolean> {
    const sql = db();
    if (!sql) return false;
    const rows = await sql<Array<{ id: string }>>`
      delete from case_pipeline_nodes
      where id::text = ${nodeId} and firm_id = ${firmId}::uuid
      returning id
    `;
    return rows.length > 0;
  },

  /** Add a directed edge. Guards that both endpoints belong to the same case;
   *  duplicate (from, to) is a no-op via the unique index. */
  async addEdge(caseId: string, firmId: string, input: NewEdgeInput): Promise<PipelineEdge | null> {
    const sql = db();
    if (!sql) return null;
    const rows = await sql<EdgeRow[]>`
      insert into case_pipeline_edges
        (case_id, firm_id, from_node_id, to_node_id, condition_label)
      select c.id, c.firm_id, ${input.fromNodeId}::uuid, ${input.toNodeId}::uuid,
             ${input.conditionLabel ?? null}
      from cases c
      where c.id::text = ${caseId} and c.firm_id = ${firmId}::uuid
        and exists (select 1 from case_pipeline_nodes n where n.id = ${input.fromNodeId}::uuid and n.case_id = c.id)
        and exists (select 1 from case_pipeline_nodes n where n.id = ${input.toNodeId}::uuid and n.case_id = c.id)
      on conflict (from_node_id, to_node_id) do nothing
      returning id, case_id, from_node_id, to_node_id, condition_label
    `;
    return rows[0] ? edgeFromRow(rows[0]) : null;
  },

  async updateEdge(edgeId: string, firmId: string, conditionLabel: string | null): Promise<PipelineEdge | null> {
    const sql = db();
    if (!sql) return null;
    const rows = await sql<EdgeRow[]>`
      update case_pipeline_edges set condition_label = ${conditionLabel}
      where id::text = ${edgeId} and firm_id = ${firmId}::uuid
      returning id, case_id, from_node_id, to_node_id, condition_label
    `;
    return rows[0] ? edgeFromRow(rows[0]) : null;
  },

  async deleteEdge(edgeId: string, firmId: string): Promise<boolean> {
    const sql = db();
    if (!sql) return false;
    const rows = await sql<Array<{ id: string }>>`
      delete from case_pipeline_edges
      where id::text = ${edgeId} and firm_id = ${firmId}::uuid
      returning id
    `;
    return rows.length > 0;
  },

  /** Set a node's status. When it becomes active/done we sync the matter's
   *  primary `cases.stage` to that node's label and write a `case_stage_events`
   *  audit row (the contract the timeline + portal read from). pending/skipped
   *  are silent corrections — no stage sync, no audit. */
  async setStatus(input: SetNodeStatusInput): Promise<{ node: PipelineNode; caseId: string } | null> {
    const sql = db();
    if (!sql) return null;
    const [row] = await sql<Array<NodeRow & { c_stage: string | null }>>`
      select n.id, n.case_id, n.label, n.status, n.pos_x, n.pos_y, n.position,
             n.application_id, c.stage as c_stage
      from case_pipeline_nodes n
      join cases c on c.id = n.case_id
      where n.id::text = ${input.nodeId} and n.firm_id = ${input.firmId}::uuid
      limit 1
    `;
    if (!row) return null;
    const fromStage = row.c_stage ?? null;
    const advancing = input.status === 'active' || input.status === 'done';

    await sql`
      update case_pipeline_nodes
      set status = ${input.status}::pipeline_node_status, updated_at = now()
      where id::text = ${input.nodeId} and firm_id = ${input.firmId}::uuid
    `;

    if (advancing) {
      await sql`
        update cases set stage = ${row.label}, updated_at = now()
        where id = ${row.case_id}::uuid and firm_id = ${input.firmId}::uuid
      `;
      await sql`
        insert into case_stage_events
          (case_id, from_stage, to_stage, actor_user_id, actor_name, note, visible_to_portal)
        values
          (${row.case_id}::uuid, ${fromStage}, ${row.label},
           ${input.actor.id}, ${input.actor.name}, ${input.note ?? null},
           ${input.visibleToPortal ?? true})
      `;
    }

    return { node: nodeFromRow({ ...row, status: input.status }), caseId: row.case_id };
  },
};

function appKindLabel(kind: ApplicationKind): string {
  switch (kind) {
    case 'ia':        return 'Interim application';
    case 'appeal':    return 'Appeal';
    case 'execution': return 'Execution';
    case 'review':    return 'Review';
    case 'bail':      return 'Bail application';
    default:          return 'Application';
  }
}

function appStatusLabel(status: ApplicationStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

interface StageEventRow {
  id: string;
  case_id: string;
  from_stage: string | null;
  to_stage: string;
  actor_user_id: string | null;
  actor_name: string | null;
  note: string | null;
  visible_to_portal: boolean;
  created_at: string | Date;
}

interface HearingRow {
  id: string;
  hearing_date: string | Date | null;
  hearing_time: string;
  court: string;
  purpose: string;
  status: string;
  created_at: string | Date;
}

interface DocumentRow {
  id: string;
  name: string;
  type: string;
  created_at: string | Date;
}

interface NoteRow {
  id: string;
  title: string | null;
  visibility: string;
  created_at: string | Date;
  author_name: string | null;
}

interface ApplicationRow {
  id: string;
  kind: ApplicationKind;
  label: string | null;
  app_type: string | null;
  status: ApplicationStatus;
  filed_on: string | Date | null;
  order_on: string | Date | null;
  created_at: string | Date;
  visible_to_portal: boolean;
}

function toIso(v: string | Date | null | undefined): string {
  if (!v) return '';
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export interface TransitionInput {
  caseId: string;
  firmId: string;
  toStage: string;
  actor: { id: string | null; name: string | null };
  note?: string | null;
  visibleToPortal?: boolean;
}

/** Returns the new stage for chaining, or null when the case wasn't found
 *  inside the firm. Always inserts an audit row when the update lands. */
export const casePipelineService = {
  catalog(type: string | null | undefined): PipelineSnapshot {
    return snapshotFor(type, null);
  },

  /**
   * Legacy stage transition — kept as a thin shim over the graph so existing
   * callers (POST /cases/:id/transition, useTransitionCase) keep working
   * during rollout. Finds the node for `toStage` on this matter (creating it
   * if the graph doesn't have one), then marks it active via `pipelineGraph.
   * setStatus`, which syncs `cases.stage` and writes the audit row.
   */
  async transition(input: TransitionInput): Promise<{ fromStage: string | null; toStage: string } | null> {
    const sql = db();
    if (!sql) return null;
    const [prev] = await sql<{ stage: string }[]>`
      select stage from cases
      where id = ${input.caseId}::uuid and firm_id = ${input.firmId}::uuid
      limit 1
    `;
    if (!prev) return null;
    const fromStage = prev.stage ?? null;

    // Ensure the graph exists (lazy-instantiates for legacy matters), then
    // resolve or create the target node by label (case-insensitive).
    const graph = await pipelineGraph.get(input.caseId, input.firmId);
    let node = graph.nodes.find((n) => n.label.toLowerCase() === input.toStage.toLowerCase());
    if (!node) {
      const created = await pipelineGraph.addNode(input.caseId, input.firmId, {
        label: input.toStage,
        x: graph.nodes.length * 220,
        y: 0,
      });
      if (!created) return null;
      node = created;
    }

    const result = await pipelineGraph.setStatus({
      nodeId: node.id,
      firmId: input.firmId,
      status: 'active',
      actor: input.actor,
      note: input.note ?? null,
      ...(input.visibleToPortal !== undefined ? { visibleToPortal: input.visibleToPortal } : {}),
    });
    if (!result) return null;

    return { fromStage, toStage: input.toStage };
  },

  /**
   * Merge stage events + hearings + documents + (shared) notes into a single
   * timeline. The `viewerScope` switch keeps the portal honest: clients only
   * see stage events flagged visible_to_portal, hearings on the matter, and
   * documents that exist on the documents table for the case. Notes are
   * advocate-side only (the case_notes module already has its own
   * shared/private model — exposing it on the portal is a deliberate
   * follow-up, not a default).
   */
  async timeline(
    caseId: string,
    firmId: string,
    viewerScope: 'advocate' | 'portal' = 'advocate',
  ): Promise<TimelineEvent[]> {
    const sql = db();
    if (!sql) return [];

    // First confirm the case belongs to this firm. Cheap, and avoids leaking
    // across tenants if the route ever forgets to scope.
    const [own] = await sql<{ id: string }[]>`
      select id from cases where id = ${caseId}::uuid and firm_id = ${firmId}::uuid limit 1
    `;
    if (!own) return [];

    const portalFilter = viewerScope === 'portal';

    const [stageRows, hearingRows, docRows, noteRows, appRows] = await Promise.all([
      sql<StageEventRow[]>`
        select id, case_id, from_stage, to_stage, actor_user_id, actor_name,
               note, visible_to_portal, created_at
        from case_stage_events
        where case_id = ${caseId}::uuid
          ${portalFilter ? sql`and visible_to_portal = true` : sql``}
        order by created_at desc
      `,
      sql<HearingRow[]>`
        select id, hearing_date, hearing_time, court, purpose, status, created_at
        from hearings
        where case_id = ${caseId}::uuid
        order by coalesce(hearing_date::timestamptz, created_at) desc
      `,
      sql<DocumentRow[]>`
        select id, name, type, created_at
        from documents
        where case_id = ${caseId}::uuid
        order by created_at desc
      `,
      portalFilter
        ? Promise.resolve([] as NoteRow[])
        : sql<NoteRow[]>`
            select n.id, n.title, n.visibility, n.created_at,
                   u.name as author_name
            from case_notes n
            left join users u on u.id = n.author_user_id
            where n.case_id = ${caseId}::uuid
            order by n.created_at desc
          `,
      sql<ApplicationRow[]>`
        select id, kind, label, app_type, status, filed_on, order_on,
               created_at, visible_to_portal
        from case_applications
        where case_id = ${caseId}::uuid
          ${portalFilter ? sql`and visible_to_portal = true` : sql``}
        order by created_at desc
      `,
    ]);

    const events: TimelineEvent[] = [];

    for (const r of stageRows) {
      const moved = r.from_stage ? `${r.from_stage} → ${r.to_stage}` : `Set to ${r.to_stage}`;
      events.push({
        id: `stage:${r.id}`,
        at: toIso(r.created_at),
        kind: 'stage',
        title: `Stage: ${moved}`,
        body: r.note ?? '',
        actorName: r.actor_name ?? undefined,
        visibleToPortal: r.visible_to_portal,
      });
    }

    for (const r of hearingRows) {
      const dateLabel = r.hearing_date
        ? (r.hearing_date instanceof Date
            ? r.hearing_date.toISOString().slice(0, 10)
            : String(r.hearing_date).slice(0, 10))
        : null;
      events.push({
        id: `hearing:${r.id}`,
        at: toIso(r.hearing_date ?? r.created_at),
        kind: 'hearing',
        title: dateLabel ? `Hearing — ${dateLabel}` : 'Hearing scheduled',
        body: [r.court, r.purpose, r.hearing_time].filter(Boolean).join(' · '),
        visibleToPortal: true,
      });
    }

    for (const r of docRows) {
      events.push({
        id: `document:${r.id}`,
        at: toIso(r.created_at),
        kind: 'document',
        title: `Document — ${r.name}`,
        body: r.type,
        visibleToPortal: true,
      });
    }

    for (const r of noteRows) {
      events.push({
        id: `note:${r.id}`,
        at: toIso(r.created_at),
        kind: 'note',
        title: r.title ? `Note — ${r.title}` : 'Note added',
        body: r.visibility === 'private' ? '(private to author)' : '',
        actorName: r.author_name ?? undefined,
        visibleToPortal: false,
      });
    }

    for (const r of appRows) {
      const name = r.label || appKindLabel(r.kind);
      events.push({
        id: `application:${r.id}`,
        at: toIso(r.order_on ?? r.filed_on ?? r.created_at),
        kind: 'application',
        title: `${appKindLabel(r.kind)} — ${name} · ${appStatusLabel(r.status)}`,
        body: r.app_type ?? '',
        visibleToPortal: r.visible_to_portal,
      });
    }

    events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return events;
  },
};
