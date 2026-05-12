import type {
  PhysicalDocument,
  CreatePhysicalDocumentRequest,
  UpdatePhysicalDocumentRequest,
} from '@lexdraft/types';
import { db } from '../db/client';

interface Row {
  id: string;
  case_id: string | null;
  case_label: string | null;
  file_no: string;
  title: string;
  doc_type: string | null;
  location: string;
  custodian: string | null;
  status: PhysicalDocument['status'];
  notes: string | null;
  received_at: Date | string | null;
  archived_at: Date | string | null;
  created_at: Date;
  updated_at: Date;
}

function toIso(v: Date | string | null): string | undefined {
  if (!v) return undefined;
  return v instanceof Date ? v.toISOString() : v;
}

function dateOnly(v: Date | string | null): string | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

function fromRow(r: Row): PhysicalDocument {
  return {
    id: r.id,
    caseId: r.case_id,
    ...(r.case_label ? { caseLabel: r.case_label } : {}),
    fileNo: r.file_no,
    title: r.title,
    ...(r.doc_type ? { docType: r.doc_type } : {}),
    location: r.location,
    ...(r.custodian ? { custodian: r.custodian } : {}),
    status: r.status,
    ...(r.notes ? { notes: r.notes } : {}),
    ...(r.received_at ? { receivedAt: dateOnly(r.received_at) } : {}),
    ...(r.archived_at ? { archivedAt: toIso(r.archived_at) } : {}),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

interface ListFilter {
  firmId: string | null;
  status?: PhysicalDocument['status'];
  q?: string;
}

/**
 * Tracks physical (paper) documents the firm holds — vakalatnamas, sworn
 * affidavits, signed contracts, court orders. Distinct from the digital
 * documents register, which tracks scans/PDFs in the cloud.
 *
 * All read/write paths require `firmId`. Null firm → empty/no-op so a
 * caller without tenant attachment never reaches another firm's rows.
 */
export const physicalDocumentsService = {
  async list(filter: ListFilter): Promise<PhysicalDocument[]> {
    if (!filter.firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select id, case_id, case_label, file_no, title, doc_type, location,
             custodian, status, notes, received_at, archived_at,
             created_at, updated_at
      from physical_documents
      where firm_id = ${filter.firmId}::uuid
        and archived_at is null
        and (${filter.status ?? null}::text is null or status = ${filter.status ?? null})
        and (
          ${filter.q ?? null}::text is null
          or lower(title)      like '%' || lower(${filter.q ?? null}) || '%'
          or lower(file_no)    like '%' || lower(${filter.q ?? null}) || '%'
          or lower(case_label) like '%' || lower(${filter.q ?? null}) || '%'
          or lower(location)   like '%' || lower(${filter.q ?? null}) || '%'
        )
      order by updated_at desc
    `;
    return rows.map(fromRow);
  },

  async get(id: string, firmId: string | null): Promise<PhysicalDocument | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    if (!sql) return undefined;
    const rows = await sql<Row[]>`
      select id, case_id, case_label, file_no, title, doc_type, location,
             custodian, status, notes, received_at, archived_at,
             created_at, updated_at
      from physical_documents
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
      limit 1
    `;
    const row = rows[0];
    return row ? fromRow(row) : undefined;
  },

  async create(input: CreatePhysicalDocumentRequest, firmId: string | null): Promise<PhysicalDocument> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached — cannot create physical document'), { status: 422 });
    }
    if (!input.fileNo?.trim() || !input.title?.trim() || !input.location?.trim()) {
      throw Object.assign(new Error('fileNo, title and location are required'), { status: 400 });
    }
    const sql = db();
    if (!sql) throw Object.assign(new Error('Database not configured'), { status: 500 });

    // If caseId is supplied, verify it belongs to this firm and pull the
    // title for caseLabel denormalisation.
    let resolvedCaseLabel = input.caseLabel?.trim() || null;
    let resolvedCaseId = input.caseId ?? null;
    if (resolvedCaseId) {
      const owned = await sql<Array<{ title: string }>>`
        select title from cases where id = ${resolvedCaseId}::uuid and firm_id = ${firmId}::uuid limit 1
      `;
      if (!owned.length) {
        throw Object.assign(new Error('Matter not found in this firm'), { status: 404 });
      }
      resolvedCaseLabel = owned[0]!.title;
    }

    const rows = await sql<Row[]>`
      insert into physical_documents (
        firm_id, case_id, case_label, file_no, title, doc_type, location,
        custodian, status, notes, received_at
      ) values (
        ${firmId}::uuid,
        ${resolvedCaseId},
        ${resolvedCaseLabel},
        ${input.fileNo.trim()},
        ${input.title.trim()},
        ${input.docType?.trim() || null},
        ${input.location.trim()},
        ${input.custodian?.trim() || null},
        ${input.status ?? 'in_chambers'},
        ${input.notes?.trim() || null},
        ${input.receivedAt || null}
      )
      returning id, case_id, case_label, file_no, title, doc_type, location,
                custodian, status, notes, received_at, archived_at,
                created_at, updated_at
    `;
    return fromRow(rows[0]!);
  },

  async update(
    id: string,
    patch: UpdatePhysicalDocumentRequest,
    firmId: string | null,
  ): Promise<PhysicalDocument | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    if (!sql) return undefined;

    // Recompute case_label if caseId is being changed.
    let nextCaseLabel: string | undefined = patch.caseLabel?.trim();
    if (patch.caseId !== undefined && patch.caseId) {
      const owned = await sql<Array<{ title: string }>>`
        select title from cases where id = ${patch.caseId}::uuid and firm_id = ${firmId}::uuid limit 1
      `;
      if (!owned.length) {
        throw Object.assign(new Error('Matter not found in this firm'), { status: 404 });
      }
      nextCaseLabel = owned[0]!.title;
    }

    const rows = await sql<Row[]>`
      update physical_documents set
        case_id      = coalesce(${patch.caseId ?? null}, case_id),
        case_label   = coalesce(${nextCaseLabel ?? null}, case_label),
        file_no      = coalesce(${patch.fileNo?.trim() || null}, file_no),
        title        = coalesce(${patch.title?.trim() || null}, title),
        doc_type     = coalesce(${patch.docType?.trim() || null}, doc_type),
        location     = coalesce(${patch.location?.trim() || null}, location),
        custodian    = coalesce(${patch.custodian?.trim() || null}, custodian),
        status       = coalesce(${patch.status ?? null}, status),
        notes        = coalesce(${patch.notes?.trim() || null}, notes),
        received_at  = coalesce(${patch.receivedAt || null}, received_at)
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
      returning id, case_id, case_label, file_no, title, doc_type, location,
                custodian, status, notes, received_at, archived_at,
                created_at, updated_at
    `;
    const row = rows[0];
    return row ? fromRow(row) : undefined;
  },

  async remove(id: string, firmId: string | null): Promise<boolean> {
    if (!firmId) return false;
    const sql = db();
    if (!sql) return false;
    // Soft-delete: set archived_at, drop the unique-fileNo conflict for future
    // rows reusing the same file number.
    const rows = await sql<Array<{ id: string }>>`
      update physical_documents set archived_at = now()
      where id = ${id}::uuid and firm_id = ${firmId}::uuid and archived_at is null
      returning id
    `;
    return rows.length > 0;
  },
};
