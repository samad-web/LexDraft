import { db } from '../db/client';
import { logger } from '../logger';
import { HttpError } from '../lib/errors';
import type { LandResult } from './tn-land-records.service';

// =============================================================================
// tn-land-tracker.service
//
// Applications an advocate follows on Tamil Nadu Land Records (patta
// transfer, F-Line) - migration 0093, table tn_land_applications.
//
// Each application stays connected to its matter. The site's Application
// Status page is CAPTCHA-gated, so LexDraft never checks it on its own: the
// advocate checks it on the Land Records screen (one captcha) and that
// result is recorded here (recordStatus). No scheduled reminders.
// =============================================================================

const APP_ID_RE = /^[0-9]{4}\/[A-Z0-9][0-9]{3}\/[0-9]{2}\/[0-9]{6}$/;

export type LandApplicationKind = 'patta_transfer' | 'fline' | 'other';

export interface LandApplication {
  id: string;
  caseId: string | null;
  caseTitle: string | null;
  titleReportId: string | null;
  applicationId: string;
  kind: LandApplicationKind;
  note: string | null;
  lastStatus: string | null;
  lastCheckedAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

interface Row {
  id: string; case_id: string | null; case_title: string | null; title_report_id: string | null;
  application_id: string; kind: LandApplicationKind; note: string | null; last_status: string | null;
  last_checked_at: Date | null; closed_at: Date | null; created_at: Date;
}

function sqlOrThrow() {
  const sql = db();
  if (!sql) throw new HttpError(503, 'Land Records tracking needs the database.', { expose: true });
  return sql;
}

/** Postgres "relation does not exist" - migration 0093 not applied yet. */
function isMissingTable(err: unknown): boolean {
  return (err as { code?: string })?.code === '42P01';
}

function notMigrated(): HttpError {
  return new HttpError(503, 'Land Records application tracking is not switched on yet (database update 0093 pending).', { code: 'LAND_TRACKING_PENDING', expose: true });
}

function toDto(r: Row): LandApplication {
  return {
    id: r.id,
    caseId: r.case_id,
    caseTitle: r.case_title,
    titleReportId: r.title_report_id,
    applicationId: r.application_id,
    kind: r.kind,
    note: r.note,
    lastStatus: r.last_status,
    lastCheckedAt: r.last_checked_at?.toISOString() ?? null,
    closedAt: r.closed_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  };
}

export async function listLandApplications(firmId: string, caseId?: string): Promise<LandApplication[]> {
  const sql = sqlOrThrow();
  try {
    const rows = await sql<Row[]>`
      select a.id, a.case_id, c.title as case_title, a.title_report_id, a.application_id, a.kind, a.note,
             a.last_status, a.last_checked_at, a.closed_at, a.created_at
      from tn_land_applications a
      left join cases c on c.id = a.case_id and c.deleted_at is null
      where a.firm_id = ${firmId}::uuid
        ${caseId ? sql`and a.case_id = ${caseId}::uuid` : sql``}
      order by a.closed_at nulls first, a.created_at desc
    `;
    return rows.map(toDto);
  } catch (err) {
    if (isMissingTable(err)) throw notMigrated();
    throw err;
  }
}

export async function addLandApplication(
  firmId: string,
  userId: string,
  input: { applicationId: string; kind: LandApplicationKind; caseId?: string | null; titleReportId?: string | null; note?: string | null },
): Promise<LandApplication> {
  const appId = input.applicationId.trim().toUpperCase();
  if (!APP_ID_RE.test(appId)) throw new HttpError(400, 'Application Id looks like 0000/0000/00/000000.');
  const sql = sqlOrThrow();
  try {
    const [row] = await sql<Array<{ id: string }>>`
      insert into tn_land_applications (firm_id, case_id, title_report_id, created_by_user_id, application_id, kind, note)
      values (${firmId}::uuid, ${input.caseId ?? null}, ${input.titleReportId ?? null}, ${userId}::uuid,
              ${appId}, ${input.kind}, ${input.note ?? null})
      on conflict (firm_id, application_id) do update set
        case_id = coalesce(excluded.case_id, tn_land_applications.case_id),
        title_report_id = coalesce(excluded.title_report_id, tn_land_applications.title_report_id),
        note = coalesce(excluded.note, tn_land_applications.note),
        closed_at = null,
        updated_at = now()
      returning id
    `;
    const all = await listLandApplications(firmId);
    return all.find((a) => a.id === row!.id)!;
  } catch (err) {
    if (isMissingTable(err)) throw notMigrated();
    throw err;
  }
}

export async function updateLandApplication(
  firmId: string,
  id: string,
  patch: { closed?: boolean; note?: string | null; caseId?: string | null },
): Promise<void> {
  const sql = sqlOrThrow();
  try {
    const rows = await sql`
      update tn_land_applications set
        closed_at = ${patch.closed === undefined ? sql`closed_at` : patch.closed ? sql`now()` : sql`null`},
        note = ${patch.note === undefined ? sql`note` : patch.note},
        case_id = ${patch.caseId === undefined ? sql`case_id` : patch.caseId},
        updated_at = now()
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
      returning id
    `;
    if (rows.length === 0) throw new HttpError(404, 'Application not found.');
  } catch (err) {
    if (isMissingTable(err)) throw notMigrated();
    throw err;
  }
}

export async function removeLandApplication(firmId: string, id: string): Promise<void> {
  const sql = sqlOrThrow();
  try {
    await sql`delete from tn_land_applications where id = ${id}::uuid and firm_id = ${firmId}::uuid`;
  } catch (err) {
    if (isMissingTable(err)) throw notMigrated();
    throw err;
  }
}

/** The status line from an Application Status result: the site's own
 *  "Status" field when there is one, else the start of the page text. */
export function statusFromResult(result: LandResult): string {
  const f = result.fields.find((x) => /status/i.test(x.label)) ?? result.fields.find((x) => /remark|stage/i.test(x.label));
  if (f) return `${f.label}: ${f.value}`.slice(0, 300);
  for (const s of result.sections) {
    const col = s.headers.findIndex((h) => /status/i.test(h));
    if (col >= 0 && s.rows[0]?.[col]) return `${s.headers[col]}: ${s.rows[0][col]}`.slice(0, 300);
  }
  return result.text.slice(0, 300) || 'No status shown';
}

/** Record what the advocate just saw on Application Status (if tracked). */
export async function recordStatus(firmId: string, applicationId: string, result: LandResult): Promise<boolean> {
  const sql = db();
  if (!sql) return false;
  try {
    const rows = await sql`
      update tn_land_applications set
        last_status = ${statusFromResult(result)},
        last_result = ${sql.json({ fields: result.fields, sections: result.sections.slice(0, 5) } as never)},
        last_checked_at = now(), updated_at = now()
      where firm_id = ${firmId}::uuid and application_id = ${applicationId.trim().toUpperCase()}
      returning id
    `;
    return rows.length > 0;
  } catch (err) {
    if (!isMissingTable(err)) logger.warn({ err }, 'tn-land: record status failed');
    return false;
  }
}

