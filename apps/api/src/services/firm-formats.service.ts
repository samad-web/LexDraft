// =============================================================================
// firm-formats.service — a firm's OWN drafting formats, drafted by the ENGINE.
//
// An advocate uploads a format on the Draft page; format-reader turns it into an
// engine template spec; the advocate reviews the preview and approves it. The spec
// lives here (table firm_engine_formats, migration 0091) and is sent to the engine
// with every draft (POST /v1/draft-spec) — the engine keeps no per-firm state.
//
// Every query is keyed by firm_id, so a firm can never see or draft another
// firm's format. Only APPROVED formats are offered for drafting.
// =============================================================================

import { db } from '../db/client';

/** Suffix that keeps a firm format's picker label distinct from built-in labels. */
export const FIRM_FORMAT_SUFFIX = ' (firm format)';
const DOC_TYPE_PREFIX = 'firm_format_';

export interface FirmFormatSpec {
  title: string;
  court_issued: boolean;
  fields: Array<Record<string, unknown> & { key: string; kind: string; required: boolean }>;
  blocks: Array<Record<string, unknown>>;
}

export interface FirmFormatReviewNotes {
  summary?: string;
  corrections?: Array<{ original: string; corrected: string }>;
  law_updates?: Array<{ original: string; updated: string; note: string }>;
  uncertain?: string[];
}

export interface FirmFormat {
  id: string;
  title: string;
  /** The Draft-page picker label: "<title> (firm format)". */
  label: string;
  /** The engine doc type used for this format: firm_format_<id hex>. */
  docType: string;
  status: 'pending_review' | 'approved';
  version: number;
  spec: FirmFormatSpec;
  reviewNotes: FirmFormatReviewNotes;
  sourceName: string;
  approvedAt: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  title: string;
  spec: FirmFormatSpec;
  review_notes: FirmFormatReviewNotes;
  status: string;
  version: number;
  source_name: string;
  approved_at: string | Date | null;
  created_at: string | Date;
}

const COLS = 'id, title, spec, review_notes, status, version, source_name, approved_at, created_at';

function iso(v: string | Date | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : v;
}

export function labelForTitle(title: string): string {
  return `${title.trim()}${FIRM_FORMAT_SUFFIX}`;
}

export function docTypeForId(id: string): string {
  return DOC_TYPE_PREFIX + id.replace(/-/g, '').toLowerCase();
}

export function isFirmFormatLabel(label: string): boolean {
  return label.endsWith(FIRM_FORMAT_SUFFIX);
}

export function isFirmFormatDocType(docType: string): boolean {
  return docType.startsWith(DOC_TYPE_PREFIX);
}

function fromRow(r: Row): FirmFormat {
  return {
    id: r.id,
    title: r.title,
    label: labelForTitle(r.title),
    docType: docTypeForId(r.id),
    status: r.status === 'approved' ? 'approved' : 'pending_review',
    version: r.version,
    spec: r.spec,
    reviewNotes: r.review_notes ?? {},
    sourceName: r.source_name ?? '',
    approvedAt: iso(r.approved_at),
    createdAt: iso(r.created_at) ?? '',
  };
}

export class FirmFormatConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirmFormatConflictError';
  }
}

export interface CreateFirmFormatInput {
  title: string;
  spec: FirmFormatSpec;
  reviewNotes: FirmFormatReviewNotes;
  sourceName: string;
  sourceSha256: string;
}

export const firmFormatsService = {
  async list(firmId: string | null, opts: { approvedOnly?: boolean } = {}): Promise<FirmFormat[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = opts.approvedOnly
      ? await sql<Row[]>`
          select ${sql.unsafe(COLS)} from firm_engine_formats
          where firm_id = ${firmId}::uuid and status = 'approved'
          order by lower(title)`
      : await sql<Row[]>`
          select ${sql.unsafe(COLS)} from firm_engine_formats
          where firm_id = ${firmId}::uuid
          order by lower(title)`;
    return rows.map(fromRow);
  },

  /** The APPROVED format behind a Draft-page label, for this firm only. */
  async getByLabel(firmId: string | null, label: string): Promise<FirmFormat | null> {
    if (!firmId || !isFirmFormatLabel(label)) return null;
    const title = label.slice(0, -FIRM_FORMAT_SUFFIX.length);
    const sql = db();
    if (!sql) return null;
    const rows = await sql<Row[]>`
      select ${sql.unsafe(COLS)} from firm_engine_formats
      where firm_id = ${firmId}::uuid and lower(title) = lower(${title}) and status = 'approved'
      limit 1`;
    return rows[0] ? fromRow(rows[0]) : null;
  },

  /** The APPROVED format saved from this exact file (by content hash), for this
   *  firm only — so the same file attached again is not read (and paid for) twice. */
  async getBySourceHash(firmId: string | null, sha256: string): Promise<FirmFormat | null> {
    if (!firmId || !sha256) return null;
    const sql = db();
    if (!sql) return null;
    const rows = await sql<Row[]>`
      select ${sql.unsafe(COLS)} from firm_engine_formats
      where firm_id = ${firmId}::uuid and source_sha256 = ${sha256} and status = 'approved'
      order by approved_at desc nulls last
      limit 1`;
    return rows[0] ? fromRow(rows[0]) : null;
  },

  /**
   * Save a reviewed format as APPROVED (the advocate approves at save time, after
   * checking the preview). Throws FirmFormatConflictError when the firm already
   * has a format with this title.
   */
  async createApproved(
    input: CreateFirmFormatInput,
    ctx: { firmId: string | null; userId: string },
  ): Promise<FirmFormat> {
    if (!ctx.firmId) {
      throw Object.assign(new Error('No firm attached — cannot save a format'), { status: 422 });
    }
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const title = input.title.trim();
    try {
      const rows = await sql<Row[]>`
        insert into firm_engine_formats
          (firm_id, title, spec, review_notes, status, source_name, source_sha256,
           approved_by, approved_at, created_by)
        values (${ctx.firmId}::uuid, ${title},
                ${sql.json({ ...input.spec, title } as never)},
                ${sql.json(input.reviewNotes as never)}, 'approved',
                ${input.sourceName.slice(0, 255)}, ${input.sourceSha256},
                ${ctx.userId}::uuid, now(), ${ctx.userId}::uuid)
        returning ${sql.unsafe(COLS)}`;
      return fromRow(rows[0]!);
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') {
        throw new FirmFormatConflictError(`Your firm already has a format called "${title}".`);
      }
      throw err;
    }
  },

  async remove(id: string, firmId: string | null): Promise<boolean> {
    if (!firmId) return false;
    const sql = db();
    if (!sql) return false;
    const rows = await sql<{ id: string }[]>`
      delete from firm_engine_formats
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
      returning id`;
    return rows.length > 0;
  },
};
