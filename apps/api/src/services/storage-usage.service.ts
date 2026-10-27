import { db } from '../db/client';
import { HttpError } from '../lib/errors';
import { FREE_STORAGE_LIMIT_BYTES } from '../lib/free-plan';

// =============================================================================
// storage-usage.service - bytes of uploaded files held per firm (account).
//
// Uploaded files live across several tables, each recording its own size.
// Usage is summed on read rather than kept in a counter, so it is always
// exact and there is nothing to drift; every table is indexed on firm_id.
// Add a line to FILE_SIZE_SOURCES when a new table stores uploaded files.
// =============================================================================

const FILE_SIZE_SOURCES = `
  select firm_id, file_size::bigint             as bytes from documents              where file_size is not null
  union all select firm_id, file_size::bigint             from case_notes            where file_size is not null
  union all select firm_id, file_size::bigint             from mock_argument_uploads
  union all select firm_id, file_size_bytes               from matter_documents      where file_size_bytes is not null
  union all select firm_id, file_size::bigint             from title_report_documents where file_size is not null
  union all select firm_id, file_size::bigint             from title_report_exports  where file_size is not null
  union all select firm_id, attachment_size_bytes::bigint from diary_entries         where attachment_size_bytes is not null
  union all select firm_id, bundle_size_bytes             from efiling_filings       where bundle_size_bytes is not null
  union all select firm_id, size_bytes                    from efiling_documents     where size_bytes is not null
`;

export class StorageFullError extends HttpError {
  constructor(usedBytes: number, limitBytes: number) {
    super(413, 'Your free storage (1 GB) is full. Delete some files or upgrade to keep uploading.', {
      code: 'storage_full',
      details: { usedBytes, limitBytes },
    });
  }
}

export const storageUsageService = {
  /** Bytes stored by one firm. */
  async firmBytes(firmId: string): Promise<number> {
    const sql = db();
    if (!sql) return 0;
    const [row] = await sql.unsafe<{ bytes: string | null }[]>(
      `select coalesce(sum(bytes), 0)::bigint as bytes from (${FILE_SIZE_SOURCES}) s where firm_id = $1::uuid`,
      [firmId],
    );
    return Number(row?.bytes ?? 0);
  },

  /** Bytes stored per firm, for the superadmin directory. */
  async bytesByFirm(): Promise<Map<string, number>> {
    const sql = db();
    const out = new Map<string, number>();
    if (!sql) return out;
    const rows = await sql.unsafe<{ firm_id: string; bytes: string }[]>(
      `select firm_id, sum(bytes)::bigint as bytes from (${FILE_SIZE_SOURCES}) s where firm_id is not null group by firm_id`,
    );
    for (const r of rows) out.set(r.firm_id, Number(r.bytes));
    return out;
  },

  /** Storage limit for a firm, or null when it has none (paid / trial firms). */
  async limitFor(firmId: string): Promise<number | null> {
    const sql = db();
    if (!sql) return null;
    const [row] = await sql<{ free_plan: boolean }[]>`select free_plan from firms where id = ${firmId}::uuid`;
    return row?.free_plan ? FREE_STORAGE_LIMIT_BYTES : null;
  },

  async status(firmId: string): Promise<{ usedBytes: number; limitBytes: number | null }> {
    const [usedBytes, limitBytes] = await Promise.all([this.firmBytes(firmId), this.limitFor(firmId)]);
    return { usedBytes, limitBytes };
  },

  /** Throws StorageFullError when adding `incomingBytes` would take a
   *  limited (free) firm over its allowance. No-op for unlimited firms. */
  async assertRoom(firmId: string | null | undefined, incomingBytes: number): Promise<void> {
    if (!firmId) return;
    const limit = await this.limitFor(firmId);
    if (limit === null) return;
    const used = await this.firmBytes(firmId);
    if (used + Math.max(0, incomingBytes) > limit) throw new StorageFullError(used, limit);
  },
};
