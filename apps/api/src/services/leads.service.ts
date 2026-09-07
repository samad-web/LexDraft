import type { Lead, LeadStage, ConflictStatus } from '@lexdraft/types';
import { db } from '../db/client';
import { logger } from '../logger';
import { clientsService } from './clients.service';

interface Row {
  id: string;
  name: string;
  value_inr: number;
  referrer: string;
  stage: LeadStage;
  captured_at: string | Date;
  contact: string | null;
  practice_area: string | null;
  matter_summary: string | null;
  probability: number | null;
  conflict_status: string | null;
  decline_reason: string | null;
  converted_client: string | null;
}

const COLS =
  'id, name, value_inr, referrer, stage, captured_at, contact, practice_area, matter_summary, probability, conflict_status, decline_reason, converted_client';

function fromRow(r: Row): Lead {
  const captured = r.captured_at instanceof Date ? r.captured_at.toISOString() : r.captured_at;
  return {
    id: r.id,
    name: r.name,
    valueInr: Number(r.value_inr ?? 0),
    referrer: r.referrer,
    stage: r.stage,
    capturedAt: captured,
    contact: r.contact ?? '',
    practiceArea: r.practice_area ?? '',
    matterSummary: r.matter_summary ?? '',
    probability: Number(r.probability ?? 50),
    conflictStatus: (r.conflict_status ?? '') as ConflictStatus,
    declineReason: r.decline_reason ?? '',
    convertedClient: r.converted_client ?? '',
  };
}

/** Fields a caller may set when capturing or editing a lead. */
export type LeadInput = Omit<Lead, 'id' | 'capturedAt' | 'convertedClient'>;

export const leadsService = {
  async list(firmId: string | null): Promise<Lead[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select ${sql.unsafe(COLS)}
      from leads
      where firm_id = ${firmId}::uuid
      order by captured_at desc
    `;
    return rows.map(fromRow);
  },

  async create(input: LeadInput, firmId: string | null): Promise<Lead> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached - cannot create lead'), { status: 422 });
    }
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<Row[]>`
      insert into leads
        (firm_id, name, value_inr, referrer, stage, contact, practice_area,
         matter_summary, probability, conflict_status, decline_reason)
      values
        (${firmId}::uuid, ${input.name}, ${input.valueInr}, ${input.referrer}, ${input.stage},
         ${input.contact}, ${input.practiceArea}, ${input.matterSummary}, ${input.probability},
         ${input.conflictStatus}, ${input.declineReason})
      returning ${sql.unsafe(COLS)}
    `;
    return fromRow(rows[0]!);
  },

  /** Partial update of any editable lead field (only provided keys are written). */
  async update(id: string, patch: Partial<LeadInput>, firmId: string | null): Promise<Lead | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    if (!sql) return undefined;
    const rows = await sql<Row[]>`
      update leads set
        name            = coalesce(${patch.name ?? null}::text, name),
        value_inr       = coalesce(${patch.valueInr ?? null}::int, value_inr),
        referrer        = coalesce(${patch.referrer ?? null}::text, referrer),
        stage           = coalesce(${(patch.stage ?? null) as string | null}::lead_stage, stage),
        contact         = coalesce(${patch.contact ?? null}::text, contact),
        practice_area   = coalesce(${patch.practiceArea ?? null}::text, practice_area),
        matter_summary  = coalesce(${patch.matterSummary ?? null}::text, matter_summary),
        probability     = coalesce(${patch.probability ?? null}::int, probability),
        conflict_status = coalesce(${(patch.conflictStatus ?? null) as string | null}::text, conflict_status),
        decline_reason  = coalesce(${patch.declineReason ?? null}::text, decline_reason)
      where id::text = ${id} and firm_id = ${firmId}::uuid
      returning ${sql.unsafe(COLS)}
    `;
    return rows[0] ? fromRow(rows[0]) : undefined;
  },

  /**
   * Move a lead to a new stage, enforcing the intake gates:
   *   - You cannot reach 'proposal' (engagement sent) or 'won' (retained) until
   *     the conflict check is CLEAR. A firm must not send an engagement or take
   *     on a client with an unresolved / adverse conflict. Returns a typed error
   *     the route maps to 409 so the UI can explain why the move was refused.
   */
  async updateStage(id: string, stage: LeadStage, firmId: string | null): Promise<Lead | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    if (!sql) return undefined;

    const gated = stage === 'proposal' || stage === 'won';
    if (gated) {
      const cur = await sql<{ conflict_status: string | null }[]>`
        select conflict_status from leads where id::text = ${id} and firm_id = ${firmId}::uuid
      `;
      if (cur.length === 0) return undefined;
      if ((cur[0]!.conflict_status ?? '') !== 'clear') {
        throw Object.assign(
          new Error('Clear the conflict check before sending an engagement or retaining this lead.'),
          { status: 409, code: 'CONFLICT_NOT_CLEARED' },
        );
      }
    }

    const rows = await sql<Row[]>`
      update leads set stage = ${stage}
      where id::text = ${id} and firm_id = ${firmId}::uuid
      returning ${sql.unsafe(COLS)}
    `;
    return rows[0] ? fromRow(rows[0]) : undefined;
  },

  /**
   * Retain a lead: create the Client record (idempotent, via the register) and
   * mark the lead 'won'. Returns the lead plus a MATTER PREFILL the web app uses
   * to open a pre-filled "New matter" form — we deliberately do NOT auto-open a
   * half-formed case (court/CNR can't be inferred from a lead); the advocate
   * confirms those. Conflict must be clear (same gate as updateStage).
   */
  async retain(
    id: string,
    firmId: string | null,
  ): Promise<{ lead: Lead; matterPrefill: { title: string; client: string; type: string; summary: string } } | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    if (!sql) return undefined;

    const found = await sql<Row[]>`
      select ${sql.unsafe(COLS)} from leads where id::text = ${id} and firm_id = ${firmId}::uuid
    `;
    if (found.length === 0) return undefined;
    const lead = fromRow(found[0]!);

    if (lead.conflictStatus !== 'clear') {
      throw Object.assign(
        new Error('Clear the conflict check before retaining this lead.'),
        { status: 409, code: 'CONFLICT_NOT_CLEARED' },
      );
    }

    // Create/link the client in the register (reuses the case→client bookkeeping).
    await clientsService.ensureByName(lead.name, firmId);

    const rows = await sql<Row[]>`
      update leads set stage = 'won', converted_client = ${lead.name}
      where id::text = ${id} and firm_id = ${firmId}::uuid
      returning ${sql.unsafe(COLS)}
    `;
    const updated = rows[0] ? fromRow(rows[0]) : lead;
    logger.info({ leadId: id, client: lead.name }, 'lead retained → client ensured');

    return {
      lead: updated,
      matterPrefill: {
        title: lead.matterSummary || lead.name,
        client: lead.name,
        type: lead.practiceArea,
        summary: lead.matterSummary,
      },
    };
  },

  async remove(id: string, firmId: string | null): Promise<boolean> {
    if (!firmId) return false;
    const sql = db();
    if (!sql) return false;
    const rows = await sql<{ id: string }[]>`
      delete from leads where id::text = ${id} and firm_id = ${firmId}::uuid returning id
    `;
    return rows.length > 0;
  },
};
