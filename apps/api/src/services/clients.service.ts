import type { Client } from '@lexdraft/types';
import { db } from '../db/client';

interface Row {
  id: string;
  name: string;
  type: Client['type'];
  status: Client['status'];
  last_contact: string | Date | null;
  matters_open: number;
  email: string | null;
  portal_enabled?: boolean;
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
    portalEnabled: !!r.portal_enabled,
    ...(r.email ? { email: r.email } : {}),
  };
}

export const clientsService = {
  async list(firmId: string | null): Promise<Client[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select c.id, c.name, c.type, c.status, c.last_contact, c.email, c.portal_enabled,
             coalesce(m.open_count, 0) as matters_open
      from clients c
      left join (
        select client, count(*) as open_count
        from cases
        where firm_id = ${firmId}::uuid and status = 'Active'
        group by client
      ) m on m.client = c.name
      where c.firm_id = ${firmId}::uuid
      order by c.name
    `;
    return rows.map(fromRow);
  },

  async create(input: Omit<Client, 'id' | 'mattersOpen'>, firmId: string | null): Promise<Client> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached — cannot create client'), { status: 422 });
    }
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<Row[]>`
      insert into clients (firm_id, name, type, status, last_contact, email)
      values (${firmId}::uuid, ${input.name}, ${input.type}, ${input.status},
              ${input.lastContact || null}, ${input.email?.toLowerCase() || null})
      returning id, name, type, status, last_contact, email, portal_enabled, 0 as matters_open
    `;
    return fromRow(rows[0]!);
  },
};
