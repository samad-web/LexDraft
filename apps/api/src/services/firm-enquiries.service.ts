import { db } from '../db/client';
import { logger } from '../logger';

export type FirmSize = '9-25' | '26-50' | '51-100' | '100+';

export interface FirmEnquiryInput {
  name: string;
  email: string;
  phone?: string;
  firmName: string;
  firmSize: FirmSize;
  primaryCourt?: string;
  practiceAreas?: string;
  message?: string;
}

export interface FirmEnquiryRecord {
  id: string;
  submittedAt: string;
  name: string;
  email: string;
  firmName: string;
  firmSize: FirmSize;
}

interface Row {
  id: string;
  submitted_at: string | Date;
  name: string;
  email: string;
  firm_name: string;
  firm_size: FirmSize;
}

function fromRow(r: Row): FirmEnquiryRecord {
  const t = r.submitted_at instanceof Date ? r.submitted_at.toISOString() : r.submitted_at;
  return {
    id: r.id,
    submittedAt: t,
    name: r.name,
    email: r.email,
    firmName: r.firm_name,
    firmSize: r.firm_size,
  };
}

export const firmEnquiriesService = {
  /**
   * Persist a new firm-tier sales enquiry. Returns just enough to confirm
   * the row was created — the partner-call workflow happens out-of-band.
   *
   * Throws if the database is not configured: the public sign-up flow
   * MUST not silently drop enquiries (unlike e.g. leads which fall back
   * to an in-memory store), because there's no second chance to capture
   * the prospect.
   */
  async create(
    input: FirmEnquiryInput,
    meta: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<FirmEnquiryRecord> {
    const sql = db();
    if (!sql) {
      throw new Error(
        'Firm enquiries require a configured DATABASE_URL — refusing to drop the submission silently.',
      );
    }

    const rows = await sql<Row[]>`
      insert into firm_enquiries (
        ip_address, user_agent,
        name, email, phone,
        firm_name, firm_size,
        primary_court, practice_areas,
        message
      ) values (
        ${meta.ipAddress ?? null}::inet, ${meta.userAgent ?? null},
        ${input.name}, ${input.email.toLowerCase()}, ${input.phone ?? null},
        ${input.firmName}, ${input.firmSize},
        ${input.primaryCourt ?? null}, ${input.practiceAreas ?? null},
        ${input.message ?? null}
      )
      returning id, submitted_at, name, email, firm_name, firm_size
    `;
    const created = fromRow(rows[0]!);
    logger.info(
      { enquiryId: created.id, firmName: created.firmName, firmSize: created.firmSize },
      'firm enquiry captured',
    );
    return created;
  },
};
