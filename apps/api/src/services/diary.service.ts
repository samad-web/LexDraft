import type { DiaryEntry } from '@lexdraft/types';
import { db } from '../db/client';

interface ListRow {
  id: string;
  entry_date: string | Date;
  entry_time: string;
  kind: DiaryEntry['kind'];
  case_label: string;
  cnr: string;
  detail: string;
  forum: string;
  attachment_file_name: string | null;
  attachment_mime: string | null;
  attachment_size_bytes: number | null;
}
interface DetailRow extends ListRow {
  attachment_base64: string | null;
}

function dateOnly(v: string | Date): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

function fromListRow(r: ListRow): DiaryEntry {
  const base: DiaryEntry = {
    id: r.id,
    date: dateOnly(r.entry_date),
    time: r.entry_time,
    kind: r.kind,
    caseLabel: r.case_label,
    cnr: r.cnr,
    detail: r.detail,
    forum: r.forum,
  };
  if (r.attachment_file_name) base.attachmentFileName = r.attachment_file_name;
  if (r.attachment_mime) base.attachmentMime = r.attachment_mime;
  if (r.attachment_size_bytes !== null) base.attachmentSize = r.attachment_size_bytes;
  return base;
}

function fromDetailRow(r: DetailRow): DiaryEntry {
  const base = fromListRow(r);
  if (r.attachment_base64) base.attachmentBase64 = r.attachment_base64;
  return base;
}

const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024; // 12 MB

function validateAttachment(input: Partial<DiaryEntry>): void {
  if (!input.attachmentBase64) return;
  // base64 expansion ratio ≈ 4/3; cap the encoded string at 16 MB so the
  // body parser limit (16 MB) is never the surprise.
  if (input.attachmentBase64.length > 16 * 1024 * 1024) {
    throw Object.assign(new Error('Attachment exceeds 12 MB cap'), { status: 413 });
  }
  if (input.attachmentSize && input.attachmentSize > MAX_ATTACHMENT_BYTES) {
    throw Object.assign(new Error('Attachment exceeds 12 MB cap'), { status: 413 });
  }
  // PDFs only for now — that's what the UI offers and the column will hold
  // anything text-encodable, but enforcing the type keeps the surface honest.
  if (input.attachmentMime && input.attachmentMime !== 'application/pdf') {
    throw Object.assign(new Error('Only PDF attachments are supported on diary entries'), { status: 415 });
  }
}

export const diaryService = {
  async list(firmId: string | null): Promise<DiaryEntry[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<ListRow[]>`
      select id, entry_date, entry_time, kind, case_label, cnr, detail, forum,
             attachment_file_name, attachment_mime, attachment_size_bytes
      from diary_entries
      where firm_id = ${firmId}::uuid
      order by entry_date asc, entry_time asc
    `;
    return rows.map(fromListRow);
  },

  async getWithAttachment(id: string, firmId: string | null): Promise<DiaryEntry | null> {
    if (!firmId) return null;
    const sql = db();
    if (!sql) return null;
    const rows = await sql<DetailRow[]>`
      select id, entry_date, entry_time, kind, case_label, cnr, detail, forum,
             attachment_file_name, attachment_mime, attachment_size_bytes,
             attachment_base64
      from diary_entries
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
      limit 1
    `;
    if (!rows[0]) return null;
    return fromDetailRow(rows[0]);
  },

  async create(input: Omit<DiaryEntry, 'id'>, firmId: string | null): Promise<DiaryEntry> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached - cannot create diary entry'), { status: 422 });
    }
    validateAttachment(input);
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<ListRow[]>`
      insert into diary_entries
        (firm_id, entry_date, entry_time, kind, case_label, cnr, detail, forum,
         attachment_file_name, attachment_mime, attachment_size_bytes, attachment_base64)
      values
        (${firmId}::uuid, ${input.date}, ${input.time}, ${input.kind}, ${input.caseLabel},
         ${input.cnr}, ${input.detail}, ${input.forum},
         ${input.attachmentFileName ?? null}, ${input.attachmentMime ?? null},
         ${input.attachmentSize ?? null}, ${input.attachmentBase64 ?? null})
      returning id, entry_date, entry_time, kind, case_label, cnr, detail, forum,
                attachment_file_name, attachment_mime, attachment_size_bytes
    `;
    return fromListRow(rows[0]!);
  },
};
