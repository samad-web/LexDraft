import type { CaseApplication, ApplicationKind, ApplicationStatus } from '@lexdraft/types';
import { db } from '../db/client';

type DbHandle = NonNullable<ReturnType<typeof db>>;

// =============================================================================
// case-applications.service
//
// First-class child entities of a matter: interim applications, appeals,
// execution petitions, review, bail. Many per case, each with its own status
// lifecycle (pending → allowed/dismissed/withdrawn/disposed) — separate from
// the main pipeline progression.
//
// `replaceForCase` is the (currently unwired) path a future eCourts sync will
// use to fold interimOrder[]/finalOrder[] in idempotently via `ext_ref`
// (= CaseOrder.order_id). The case_applications_extref_uniq index makes
// re-sync an upsert. Manual rows carry source='manual' and no ext_ref.
// =============================================================================

interface CaseApplicationRow {
  id: string;
  case_id: string;
  kind: ApplicationKind;
  label: string | null;
  app_type: string | null;
  filed_on: string | Date | null;
  status: ApplicationStatus;
  order_on: string | Date | null;
  notes: string | null;
  position: number;
  source: 'manual' | 'ecourts';
  visible_to_portal: boolean;
}

/** Date columns arrive as JS Date or string depending on the driver path;
 *  normalise to a bare YYYY-MM-DD (or null). */
function dateIso(v: string | Date | null): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function fromRow(r: CaseApplicationRow): CaseApplication {
  return {
    id:              r.id,
    caseId:          r.case_id,
    kind:            r.kind,
    label:           r.label,
    appType:         r.app_type,
    filedOn:         dateIso(r.filed_on),
    status:          r.status,
    orderOn:         dateIso(r.order_on),
    notes:           r.notes,
    position:        r.position,
    source:          r.source,
    visibleToPortal: r.visible_to_portal,
  };
}

export interface NewCaseApplication {
  kind?: ApplicationKind;
  label?: string | null;
  appType?: string | null;
  filedOn?: string | null;
  status?: ApplicationStatus;
  orderOn?: string | null;
  notes?: string | null;
  source?: 'manual' | 'ecourts';
  visibleToPortal?: boolean;
  /** eCourts dedupe key (CaseOrder.order_id). Manual rows leave this null. */
  extRef?: string | null;
}

export type CaseApplicationPatch = Partial<NewCaseApplication>;

export const caseApplicationsService = {
  /** Read all applications for a case, ordered by position. Multi-tenant
   *  safety via the join through `cases.firm_id`. When `portalOnly` is set,
   *  only rows flagged visible_to_portal are returned. */
  async listForCase(
    caseId: string,
    firmId: string,
    opts: { portalOnly?: boolean } = {},
  ): Promise<CaseApplication[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<CaseApplicationRow[]>`
      select a.id, a.case_id, a.kind, a.label, a.app_type, a.filed_on, a.status,
             a.order_on, a.notes, a.position, a.source, a.visible_to_portal
      from case_applications a
      join cases c on c.id = a.case_id
      where a.case_id::text = ${caseId} and c.firm_id = ${firmId}::uuid
        ${opts.portalOnly ? sql`and a.visible_to_portal = true` : sql``}
      order by a.position, a.created_at
    `;
    return rows.map(fromRow);
  },

  /** Create an application. The insert-from-select scopes by `cases.firm_id`
   *  so a caseId from another firm cannot be written to, and derives firm_id
   *  from the case row rather than trusting the caller. */
  async create(
    caseId: string,
    firmId: string,
    input: NewCaseApplication,
  ): Promise<CaseApplication | null> {
    const sql = db();
    if (!sql) return null;
    const rows = await sql<CaseApplicationRow[]>`
      insert into case_applications
        (case_id, firm_id, kind, label, app_type, filed_on, status, order_on,
         notes, position, source, visible_to_portal, ext_ref)
      select c.id, c.firm_id,
             ${input.kind ?? 'ia'}::application_kind,
             ${input.label ?? null}, ${input.appType ?? null},
             ${input.filedOn ?? null}::date,
             ${input.status ?? 'pending'}::application_status,
             ${input.orderOn ?? null}::date,
             ${input.notes ?? null},
             coalesce((select max(position) + 1 from case_applications where case_id = c.id), 0),
             ${input.source ?? 'manual'},
             ${input.visibleToPortal ?? true},
             ${input.extRef ?? null}
      from cases c
      where c.id::text = ${caseId} and c.firm_id = ${firmId}::uuid
      returning id, case_id, kind, label, app_type, filed_on, status,
                order_on, notes, position, source, visible_to_portal
    `;
    return rows[0] ? fromRow(rows[0]) : null;
  },

  /** Patch an application. Scoped by the denormalised firm_id. */
  async update(
    id: string,
    firmId: string,
    patch: CaseApplicationPatch,
  ): Promise<CaseApplication | null> {
    const sql = db();
    if (!sql) return null;
    const rows = await sql<CaseApplicationRow[]>`
      update case_applications set
        kind              = coalesce(${patch.kind ?? null}::application_kind, kind),
        label             = ${patch.label !== undefined ? patch.label : sql`label`},
        app_type          = ${patch.appType !== undefined ? patch.appType : sql`app_type`},
        filed_on          = ${patch.filedOn !== undefined ? sql`${patch.filedOn}::date` : sql`filed_on`},
        status            = coalesce(${patch.status ?? null}::application_status, status),
        order_on          = ${patch.orderOn !== undefined ? sql`${patch.orderOn}::date` : sql`order_on`},
        notes             = ${patch.notes !== undefined ? patch.notes : sql`notes`},
        visible_to_portal = coalesce(${patch.visibleToPortal ?? null}, visible_to_portal),
        updated_at        = now()
      where id::text = ${id} and firm_id = ${firmId}::uuid
      returning id, case_id, kind, label, app_type, filed_on, status,
                order_on, notes, position, source, visible_to_portal
    `;
    return rows[0] ? fromRow(rows[0]) : null;
  },

  async remove(id: string, firmId: string): Promise<boolean> {
    const sql = db();
    if (!sql) return false;
    const rows = await sql<Array<{ id: string }>>`
      delete from case_applications
      where id::text = ${id} and firm_id = ${firmId}::uuid
      returning id
    `;
    return rows.length > 0;
  },

  /** Atomically replace the eCourts-sourced applications for a case. Accepts a
   *  transaction handle so a sync can fold this in. Only wipes source='ecourts'
   *  rows so manual entries survive. NOT wired yet — built for the later sync
   *  pass that maps CaseOrder[] into applications. */
  async replaceForCase(
    caseId: string,
    firmId: string,
    items: NewCaseApplication[],
    tx?: DbHandle,
  ): Promise<void> {
    const exec = tx ?? db();
    if (!exec) return;
    await exec`
      delete from case_applications
      where case_id::text = ${caseId} and firm_id = ${firmId}::uuid and source = 'ecourts'
    `;
    let i = 0;
    for (const item of items) {
      await exec`
        insert into case_applications
          (case_id, firm_id, kind, label, app_type, filed_on, status, order_on,
           notes, position, source, visible_to_portal, ext_ref)
        select c.id, c.firm_id,
               ${item.kind ?? 'other'}::application_kind,
               ${item.label ?? null}, ${item.appType ?? null},
               ${item.filedOn ?? null}::date,
               ${item.status ?? 'pending'}::application_status,
               ${item.orderOn ?? null}::date,
               ${item.notes ?? null}, ${i}, 'ecourts',
               ${item.visibleToPortal ?? true}, ${item.extRef ?? null}
        from cases c
        where c.id::text = ${caseId} and c.firm_id = ${firmId}::uuid
        on conflict (case_id, ext_ref) where ext_ref is not null do update set
          kind = excluded.kind, label = excluded.label, app_type = excluded.app_type,
          filed_on = excluded.filed_on, status = excluded.status,
          order_on = excluded.order_on, updated_at = now()
      `;
      i += 1;
    }
  },
};
