import type { DocumentRecord } from '@lexdraft/types';
import { db } from '../db/client';
import { SEED_DOCS } from '../data/seed';

interface DocRow {
  id: string;
  case_label: string;
  name: string;
  type: string;
  updated_label: string;
}

const memory: (DocumentRecord & { id: string })[] = SEED_DOCS.map((d, i) => ({ ...d, id: `d${i + 1}` }));

function fromRow(r: DocRow): DocumentRecord & { id: string } {
  return {
    id: r.id,
    case: r.case_label,
    name: r.name,
    type: r.type,
    updated: r.updated_label,
  };
}

export const documentsService = {
  async list(): Promise<DocumentRecord[]> {
    const sql = db();
    if (sql) {
      const rows = await sql<DocRow[]>`
        select id, case_label, name, type, updated_label
        from documents order by created_at desc
      `;
      return rows.map(fromRow);
    }
    return memory;
  },

  async get(id: string): Promise<DocumentRecord | undefined> {
    const sql = db();
    if (sql) {
      const rows = await sql<DocRow[]>`
        select id, case_label, name, type, updated_label
        from documents where id::text = ${id} limit 1
      `;
      const row = rows[0];
      return row ? fromRow(row) : undefined;
    }
    return memory.find((d) => d.id === id);
  },

  async create(input: Omit<DocumentRecord, 'id'>): Promise<DocumentRecord> {
    const sql = db();
    if (sql) {
      const rows = await sql<DocRow[]>`
        insert into documents (case_label, name, type, updated_label)
        values (${input.case}, ${input.name}, ${input.type}, ${input.updated})
        returning id, case_label, name, type, updated_label
      `;
      return fromRow(rows[0]!);
    }
    const d = { ...input, id: `d${memory.length + 1}` };
    memory.unshift(d);
    return d;
  },
};
