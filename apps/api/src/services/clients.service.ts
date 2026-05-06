import type { Client } from '@lexdraft/types';
import { db } from '../db/client';

interface Row {
  id: string;
  name: string;
  type: Client['type'];
  status: Client['status'];
  last_contact: string | Date | null;
  matters_open: number;
}

function fromRow(r: Row): Client {
  const lc = r.last_contact instanceof Date
    ? r.last_contact.toISOString().slice(0, 10)
    : (r.last_contact ?? '');
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    status: r.status,
    lastContact: lc,
    mattersOpen: Number(r.matters_open ?? 0),
  };
}

export const clientsService = {
  async list(): Promise<Client[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select c.id, c.name, c.type, c.status, c.last_contact,
             coalesce(m.open_count, 0) as matters_open
      from clients c
      left join (
        select client, count(*) as open_count
        from cases where status = 'Active'
        group by client
      ) m on m.client = c.name
      order by c.name
    `;
    return rows.map(fromRow);
  },

  async create(input: Omit<Client, 'id' | 'mattersOpen'>): Promise<Client> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<Row[]>`
      insert into clients (name, type, status, last_contact)
      values (${input.name}, ${input.type}, ${input.status},
              ${input.lastContact || null})
      returning id, name, type, status, last_contact, 0 as matters_open
    `;
    return fromRow(rows[0]!);
  },
};
