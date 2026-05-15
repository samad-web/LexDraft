import type { DocumentRecord } from '@lexdraft/types';
import { db } from '../db/client';
import { SEED_DOCS } from '../data/seed';
import { storage } from './storage.service';

interface DocRow {
  id: string;
  case_label: string;
  name: string;
  type: string;
  updated_label: string;
  storage_key: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: string | number | null;
  shared_with_client?: boolean;
  requires_acknowledgement?: boolean;
  signed_at?: Date | string | null;
}

const memory: (DocumentRecord & { id: string })[] = SEED_DOCS.map((d, i) => ({ ...d, id: `d${i + 1}` }));

/**
 * In-memory metadata for documents created in demo mode (no DATABASE_URL). DB
 * mode reads/writes columns directly. Keeps the legacy fileBase64 path alive
 * for clients that haven't migrated to the presigned-URL flow yet.
 */
interface MemFile {
  storageKey?: string;
  fileName: string;
  fileMime: string;
  fileSize: number;
  fileBase64?: string;
}
const memoryFiles = new Map<string, MemFile>();

function fromRow(r: DocRow): DocumentRecord & { id: string } {
  const file: Partial<DocumentRecord> = r.storage_key
    ? {
        hasFile: true,
        storageKey: r.storage_key,
        fileName: r.file_name ?? undefined,
        fileMime: r.file_mime ?? undefined,
        fileSize: r.file_size != null ? Number(r.file_size) : undefined,
      }
    : {};
  const signedAtIso =
    r.signed_at instanceof Date ? r.signed_at.toISOString()
    : typeof r.signed_at === 'string' ? r.signed_at
    : undefined;
  return {
    id: r.id,
    case: r.case_label,
    name: r.name,
    type: r.type,
    updated: r.updated_label,
    kind: 'document',
    sharedWithClient: !!r.shared_with_client,
    requiresAcknowledgement: !!r.requires_acknowledgement,
    ...(signedAtIso ? { signedAt: signedAtIso } : {}),
    ...file,
  };
}

function withFileFlags(rec: DocumentRecord & { id: string }): DocumentRecord {
  if (rec.hasFile) return rec;
  const f = memoryFiles.get(rec.id);
  if (!f) return { ...rec, kind: 'document' };
  return {
    ...rec,
    kind: 'document',
    hasFile: true,
    fileName: f.fileName,
    fileMime: f.fileMime,
    fileSize: f.fileSize,
    ...(f.storageKey ? { storageKey: f.storageKey } : {}),
  };
}

function withFileFull(rec: DocumentRecord & { id: string }): DocumentRecord {
  const flagged = withFileFlags(rec);
  if (!flagged.hasFile) return flagged;
  const f = memoryFiles.get(rec.id);
  if (!f || !f.fileBase64) return flagged;
  return { ...flagged, fileBase64: f.fileBase64 };
}

export interface CreateDocumentInput extends Omit<DocumentRecord, 'id'> {
  fileName?: string;
  fileMime?: string;
  fileSize?: number;
  fileBase64?: string;
  storageKey?: string;
}

export const documentsService = {
  async list(firmId: string | null): Promise<DocumentRecord[]> {
    if (!firmId) return [];
    const sql = db();
    if (sql) {
      const rows = await sql<DocRow[]>`
        select id, case_label, name, type, updated_label,
               storage_key, file_name, file_mime, file_size,
               shared_with_client, requires_acknowledgement, signed_at
        from documents
        where firm_id = ${firmId}::uuid
        order by created_at desc
      `;
      return rows.map(fromRow).map(withFileFlags);
    }
    return memory.map(withFileFlags);
  },

  async get(id: string, firmId: string | null): Promise<DocumentRecord | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    if (sql) {
      const rows = await sql<DocRow[]>`
        select id, case_label, name, type, updated_label,
               storage_key, file_name, file_mime, file_size,
               shared_with_client, requires_acknowledgement, signed_at
        from documents where id::text = ${id} and firm_id = ${firmId}::uuid limit 1
      `;
      const row = rows[0];
      return row ? withFileFull(fromRow(row)) : undefined;
    }
    const rec = memory.find((d) => d.id === id);
    return rec ? withFileFull(rec) : undefined;
  },

  async create(input: CreateDocumentInput, firmId: string | null): Promise<DocumentRecord> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached - cannot create document'), { status: 422 });
    }
    const sql = db();
    if (sql) {
      const rows = await sql<DocRow[]>`
        insert into documents (firm_id, case_label, name, type, updated_label,
                               storage_key, file_name, file_mime, file_size)
        values (${firmId}::uuid, ${input.case}, ${input.name}, ${input.type}, ${input.updated},
                ${input.storageKey ?? null}, ${input.fileName ?? null},
                ${input.fileMime ?? null}, ${input.fileSize ?? null})
        returning id, case_label, name, type, updated_label,
                  storage_key, file_name, file_mime, file_size,
                  shared_with_client, requires_acknowledgement, signed_at
      `;
      const persisted = fromRow(rows[0]!);
      // If the legacy base64 path was used, persist the bytes via storage().
      if (input.fileBase64 && input.fileMime && input.fileName && typeof input.fileSize === 'number' && !input.storageKey) {
        const key = `documents/${firmId}/${persisted.id}/${input.fileName}`;
        await storage().putObject({
          key,
          body: Buffer.from(input.fileBase64, 'base64'),
          contentType: input.fileMime,
        });
        await sql`
          update documents
          set storage_key = ${key}, file_name = ${input.fileName},
              file_mime = ${input.fileMime}, file_size = ${input.fileSize}
          where id = ${persisted.id}::uuid
        `;
        return withFileFlags({ ...persisted, storageKey: key, hasFile: true,
          fileName: input.fileName, fileMime: input.fileMime, fileSize: input.fileSize });
      }
      return withFileFlags(persisted);
    }

    // memory mode
    const stored = { case: input.case, name: input.name, type: input.type, updated: input.updated, id: `d${memory.length + 1}` };
    memory.unshift(stored);
    if (input.fileBase64 && input.fileMime && input.fileName && typeof input.fileSize === 'number') {
      memoryFiles.set(stored.id, {
        fileName: input.fileName,
        fileMime: input.fileMime,
        fileSize: input.fileSize,
        fileBase64: input.fileBase64,
      });
    }
    return withFileFlags(stored);
  },

  /** Attach an already-uploaded blob (presigned-URL flow) to a document row. */
  async attachStorage(
    id: string,
    firmId: string | null,
    file: { storageKey: string; fileName: string; fileMime: string; fileSize: number },
  ): Promise<DocumentRecord | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    if (sql) {
      const rows = await sql<DocRow[]>`
        update documents set
          storage_key = ${file.storageKey},
          file_name   = ${file.fileName},
          file_mime   = ${file.fileMime},
          file_size   = ${file.fileSize},
          updated_label = 'just now'
        where id::text = ${id} and firm_id = ${firmId}::uuid
        returning id, case_label, name, type, updated_label,
                  storage_key, file_name, file_mime, file_size,
                  shared_with_client, requires_acknowledgement, signed_at
      `;
      const row = rows[0];
      return row ? withFileFlags(fromRow(row)) : undefined;
    }
    const rec = memory.find((d) => d.id === id);
    if (!rec) return undefined;
    memoryFiles.set(id, { ...file });
    return withFileFlags(rec);
  },

  async getStorageKey(id: string, firmId: string | null): Promise<{ key: string; fileMime: string } | null> {
    if (!firmId) return null;
    const sql = db();
    if (sql) {
      const rows = await sql<Array<{ storage_key: string | null; file_mime: string | null }>>`
        select storage_key, file_mime from documents
        where id::text = ${id} and firm_id = ${firmId}::uuid limit 1
      `;
      const row = rows[0];
      if (!row || !row.storage_key) return null;
      return { key: row.storage_key, fileMime: row.file_mime ?? 'application/octet-stream' };
    }
    const f = memoryFiles.get(id);
    if (!f || !f.storageKey) return null;
    return { key: f.storageKey, fileMime: f.fileMime };
  },
};
