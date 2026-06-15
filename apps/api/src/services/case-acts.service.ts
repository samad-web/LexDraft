import type { CaseAct } from '@lexdraft/types';
import { db } from '../db/client';

type DbHandle = NonNullable<ReturnType<typeof db>>;

// =============================================================================
// case-acts.service
//
// Stores the acts + sections each matter is filed under. The eCourts gateway
// is the primary source — `replaceForCase` is the path the sync uses to
// atomically refresh the full set on every pull. Users can add their own
// rows via the matter UI later; those carry source='manual' and are skipped
// when eCourts re-syncs (today we wipe-and-replace; that's a TODO once
// manual entries exist).
// =============================================================================

interface CaseActRow {
  id: string;
  case_id: string;
  act_name: string;
  section: string;
  position: number;
  source: 'ecourts' | 'manual';
}

function fromRow(r: CaseActRow): CaseAct {
  return {
    id:       r.id,
    caseId:   r.case_id,
    actName:  r.act_name,
    section:  r.section,
    position: r.position,
    source:   r.source,
  };
}

export interface NewCaseAct {
  actName: string;
  section: string;
  source?: 'ecourts' | 'manual';
}

export const caseActsService = {
  /** Read all acts for a case, ordered by position. Multi-tenant safety is
   *  enforced by the join through `cases.firm_id`. */
  async listForCase(caseId: string, firmId: string): Promise<CaseAct[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<CaseActRow[]>`
      select a.id, a.case_id, a.act_name, a.section, a.position, a.source
      from case_acts a
      join cases c on c.id = a.case_id
      where a.case_id::text = ${caseId} and c.firm_id = ${firmId}::uuid
      order by a.position
    `;
    return rows.map(fromRow);
  },

  /** Atomically replace the full set of acts for a case. Accepts a connection
   *  / transaction handle so the caller can fold this into a bigger sync
   *  transaction (case-sync.service.ts does this). When `tx` is omitted we
   *  open a single statement against the global pool. */
  async replaceForCase(
    caseId: string,
    items: NewCaseAct[],
    tx?: DbHandle,
  ): Promise<void> {
    const exec = tx ?? db();
    if (!exec) return;
    await exec`delete from case_acts where case_id::text = ${caseId}`;
    let i = 0;
    for (const item of items) {
      await exec`
        insert into case_acts (case_id, act_name, section, position, source)
        values (${caseId}::uuid, ${item.actName}, ${item.section},
                ${i}, ${item.source ?? 'ecourts'})
      `;
      i += 1;
    }
  },
};
