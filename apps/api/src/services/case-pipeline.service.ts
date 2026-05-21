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

import { db } from '../db/client';

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

export type TimelineEventKind = 'stage' | 'hearing' | 'document' | 'note';

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

    await sql`
      update cases
      set stage = ${input.toStage}
      where id = ${input.caseId}::uuid and firm_id = ${input.firmId}::uuid
    `;

    await sql`
      insert into case_stage_events
        (case_id, from_stage, to_stage, actor_user_id, actor_name, note, visible_to_portal)
      values
        (${input.caseId}::uuid, ${fromStage}, ${input.toStage},
         ${input.actor.id}, ${input.actor.name}, ${input.note ?? null},
         ${input.visibleToPortal ?? true})
    `;

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

    const [stageRows, hearingRows, docRows, noteRows] = await Promise.all([
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

    events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return events;
  },
};
