import { db } from '../db/client';
import { logger } from '../logger';

/**
 * demo-requests.service — public capture of "show me the product" submissions
 * from the landing page. Sibling of firm-enquiries.service: same shape, but
 * separates contact vs schedule intent so sales can route the queue.
 */

export type DemoType = 'contact' | 'schedule';

export interface DemoRequestInput {
  name: string;
  email: string;
  firmName?: string;
  phone?: string;
  preferredTime?: string;
  message?: string;
  demoType: DemoType;
}

export interface DemoRequestRecord {
  id: string;
  submittedAt: string;
  name: string;
  email: string;
  demoType: DemoType;
}

interface Row {
  id: string;
  submitted_at: string | Date;
  name: string;
  email: string;
  demo_type: DemoType;
}

function fromRow(r: Row): DemoRequestRecord {
  const t = r.submitted_at instanceof Date ? r.submitted_at.toISOString() : r.submitted_at;
  return {
    id: r.id,
    submittedAt: t,
    name: r.name,
    email: r.email,
    demoType: r.demo_type,
  };
}

export const demoRequestsService = {
  async create(
    input: DemoRequestInput,
    meta: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<DemoRequestRecord> {
    const sql = db();
    if (!sql) {
      // Same policy as firm-enquiries: never silently drop a public submission
      // — there is no second chance to capture the prospect.
      throw new Error(
        'Demo requests require a configured DATABASE_URL — refusing to drop the submission silently.',
      );
    }
    const rows = await sql<Row[]>`
      insert into demo_requests (
        ip_address, user_agent,
        name, email, firm_name, phone,
        preferred_time, message, demo_type
      ) values (
        ${meta.ipAddress ?? null}::inet, ${meta.userAgent ?? null},
        ${input.name}, ${input.email.toLowerCase()},
        ${input.firmName ?? null}, ${input.phone ?? null},
        ${input.preferredTime ?? null}, ${input.message ?? null},
        ${input.demoType}
      )
      returning id, submitted_at, name, email, demo_type
    `;
    const created = fromRow(rows[0]!);
    logger.info(
      { demoRequestId: created.id, demoType: created.demoType, email: created.email },
      'demo request captured',
    );
    return created;
  },
};
