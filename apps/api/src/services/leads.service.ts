import type { Lead } from '@lexdraft/types';
import { db } from '../db/client';

interface Row {
  id: string;
  name: string;
  value_inr: number;
  referrer: string;
  stage: Lead['stage'];
  captured_at: string | Date;
}

function fromRow(r: Row): Lead {
  const captured = r.captured_at instanceof Date ? r.captured_at.toISOString() : r.captured_at;
  return {
    id: r.id,
    name: r.name,
    valueInr: Number(r.value_inr ?? 0),
    referrer: r.referrer,
    stage: r.stage,
    capturedAt: captured,
  };
}

export const leadsService = {
  async list(firmId: string | null): Promise<Lead[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select id, name, value_inr, referrer, stage, captured_at
      from leads
      where firm_id = ${firmId}::uuid
      order by captured_at desc
    `;
    return rows.map(fromRow);
  },

  async create(input: Omit<Lead, 'id' | 'capturedAt'>, firmId: string | null): Promise<Lead> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached - cannot create lead'), { status: 422 });
    }
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<Row[]>`
      insert into leads (firm_id, name, value_inr, referrer, stage)
      values (${firmId}::uuid, ${input.name}, ${input.valueInr}, ${input.referrer}, ${input.stage})
      returning id, name, value_inr, referrer, stage, captured_at
    `;
    return fromRow(rows[0]!);
  },

  async updateStage(id: string, stage: Lead['stage'], firmId: string | null): Promise<Lead | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    if (!sql) return undefined;
    const rows = await sql<Row[]>`
      update leads set stage = ${stage}
      where id::text = ${id} and firm_id = ${firmId}::uuid
      returning id, name, value_inr, referrer, stage, captured_at
    `;
    return rows[0] ? fromRow(rows[0]) : undefined;
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
