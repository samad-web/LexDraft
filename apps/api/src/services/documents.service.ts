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
        // Sanitise the filename for the storage KEY only — the local driver's
        // safeKey() allows just [a-zA-Z0-9/_.-], so spaces and parentheses
        // (e.g. "VENKI PUBLICATION 138 notice.pdf", "AGREEMENT (1).pdf") would
        // otherwise be rejected as an "Invalid storage key". The DB keeps the
        // real display name; only the on-disk key is slugged. Mirrors the
        // presigned-upload path in documents.routes.ts.
        const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 200) || 'file';
        const key = `documents/${firmId}/${persisted.id}/${safeName}`;
        try {
          await storage().putObject({
            key,
            body: Buffer.from(input.fileBase64, 'base64'),
            contentType: input.fileMime,
          });
          // Verify the bytes are actually readable back before we mark the row
          // as file-bearing. This catches a storage backend that silently drops
          // the write (e.g. a sync-managed dir that dehydrates the file) so we
          // never leave a row that CLAIMS to have a file the engine can't read.
          const readback = await storage().getObject(key);
          if (!readback || readback.body.length === 0) {
            throw new Error('stored object could not be read back');
          }
        } catch (err) {
          // Roll back the phantom row — better to fail the upload loudly than to
          // create a metadata-only document that reads as empty forever.
          await sql`delete from documents where id = ${persisted.id}::uuid`.catch(() => {});
          throw Object.assign(
            new Error(`Uploaded file could not be stored: ${(err as Error).message}`),
            { status: 502 },
          );
        }
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
          -- INVALIDATE the extracted-text cache: a new file replaces the old
          -- content, so the cached text (and its size stamp) no longer apply.
          -- Nulled here; caseDocumentText re-extracts and re-caches on next read.
          extracted_text        = null,
          extracted_empty       = null,
          extracted_source_size = null,
          extracted_at          = null,
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

  /** Patch metadata. Only the four user-editable fields are accepted; storage
   *  and portal flags have their own endpoints. Returns `undefined` if the
   *  row doesn't exist or is in a different firm (treated as 404 upstream). */
  async update(
    id: string,
    firmId: string | null,
    patch: { name?: string; type?: string; case?: string },
  ): Promise<DocumentRecord | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    if (sql) {
      // Only set columns that were actually supplied in the patch; coalesce
      // through the existing value otherwise.
      const rows = await sql<DocRow[]>`
        update documents set
          name          = coalesce(${patch.name ?? null}, name),
          type          = coalesce(${patch.type ?? null}, type),
          case_label    = coalesce(${patch.case ?? null}, case_label),
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
    if (patch.name !== undefined) rec.name = patch.name;
    if (patch.type !== undefined) rec.type = patch.type;
    if (patch.case !== undefined) rec.case = patch.case;
    rec.updated = 'just now';
    return withFileFlags(rec);
  },

  /** Hard-delete a document and (best-effort) the attached storage object.
   *  Returns false if the document doesn't exist in the caller's firm. */
  async remove(id: string, firmId: string | null): Promise<boolean> {
    if (!firmId) return false;
    const sql = db();
    if (sql) {
      // Read the storage key first so we can clean up the blob after the row
      // is gone. Doing it in this order means a DB rollback leaves the blob
      // intact (better than orphaning a row that points at a deleted blob).
      const keyRows = await sql<Array<{ storage_key: string | null }>>`
        select storage_key from documents
        where id::text = ${id} and firm_id = ${firmId}::uuid limit 1
      `;
      const storageKey = keyRows[0]?.storage_key ?? null;
      const deleted = await sql<Array<{ id: string }>>`
        delete from documents
        where id::text = ${id} and firm_id = ${firmId}::uuid
        returning id
      `;
      if (deleted.length === 0) return false;
      if (storageKey) {
        // Storage failures must not bubble up — the row is already gone.
        try {
          await storage().delete(storageKey);
        } catch {
          /* swallow */
        }
      }
      return true;
    }
    const idx = memory.findIndex((d) => d.id === id);
    if (idx < 0) return false;
    memory.splice(idx, 1);
    memoryFiles.delete(id);
    return true;
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

  /**
   * Gather the extracted TEXT of every document filed against a case label, so
   * the drafting engine can read the matter's papers (cheque, notice,
   * agreement, …) without the advocate re-attaching them. Files are extracted
   * on the fly - pdf-parse with an OCR fallback for scans, DOCX via mammoth -
   * because case documents are stored as raw files, not pre-extracted text.
   *
   * Best-effort: a file that can't be read is skipped (never throws), and the
   * total is capped so a huge matter can't blow the engine's prompt budget.
   */
  async caseDocumentText(
    caseLabel: string,
    firmId: string | null,
  ): Promise<{ items: Array<{ name: string; text: string }>; unreadable: string[] }> {
    if (!firmId || !caseLabel.trim()) return { items: [], unreadable: [] };
    const { extractText } = await import('../lib/text-extraction');
    const label = caseLabel.trim().toLowerCase();

    const all = await documentsService.list(firmId);
    const forCase = all.filter(
      (d) => d.kind === 'document' && (d.case ?? '').trim().toLowerCase() === label,
    );

    const out: Array<{ name: string; text: string }> = [];
    const unreadable: string[] = []; // attached but no bytes / no extractable text
    let budget = 60_000; // total chars fed to the engine across all docs
    const conn = db();
    for (const d of forCase) {
      if (!d.id) continue;
      if (budget <= 0) { unreadable.push(d.name); continue; }

      // 1. CACHE HIT. Extraction is EXPENSIVE — a large scanned PDF re-OCR'd on
      //    every draft took minutes, so the web fetch timed out and the doc's text
      //    never reached the engine. Read the cached text first; a row is a valid
      //    hit when it was extracted from the SAME file size that's on record now
      //    (a replaced/re-uploaded file has a different size and re-extracts).
      const sizeNow = d.fileSize != null ? Number(d.fileSize) : null;
      if (conn) {
        const cached = await conn<Array<{
          extracted_text: string | null;
          extracted_empty: boolean | null;
          extracted_source_size: string | number | null;
        }>>`
          select extracted_text, extracted_empty, extracted_source_size
          from documents where id = ${d.id}::uuid and firm_id = ${firmId}::uuid`;
        const row = cached[0];
        const cachedSize = row?.extracted_source_size != null ? Number(row.extracted_source_size) : null;
        const sizeMatches = sizeNow == null || cachedSize == null ? true : cachedSize === sizeNow;
        if (row && sizeMatches && (row.extracted_text != null || row.extracted_empty != null)) {
          if (row.extracted_empty) { unreadable.push(d.name); continue; }
          const cachedText = (row.extracted_text ?? '').trim();
          if (cachedText) {
            const clip = cachedText.slice(0, budget);
            budget -= clip.length;
            out.push({ name: d.name, text: clip });
            continue;
          }
        }
      }

      // 2. CACHE MISS — resolve the file bytes: storage object first, else legacy base64.
      let bytes: Buffer | null = null;
      let mime = d.fileMime ?? '';
      const full = await documentsService.get(d.id, firmId);
      if (full?.storageKey) {
        const obj = await storage().getObject(full.storageKey);
        if (obj) { bytes = obj.body; mime = mime || obj.contentType; }
      } else if (full?.fileBase64) {
        bytes = Buffer.from(full.fileBase64, 'base64');
      }
      // No stored bytes at all — the file was registered as metadata but its
      // content never landed in storage (e.g. an upload that didn't finalize).
      // Surface it so the UI can tell the advocate to re-upload, rather than
      // silently feeding the engine nothing.
      if (!bytes) { unreadable.push(d.name); continue; }

      const res = await extractText({
        body: bytes,
        mime,
        fileName: d.fileName ?? d.name,
      });
      const gotText = res.ok && res.text.trim().length > 0;
      // 3. PERSIST the result (positive OR negative) so the NEXT draft is instant.
      //    Best-effort: a cache-write failure must not break the read.
      if (conn) {
        try {
          await conn`
            update documents set
              extracted_text        = ${gotText ? res.text.trim() : null},
              extracted_empty       = ${!gotText},
              extracted_source_size = ${sizeNow},
              extracted_at          = now()
            where id = ${d.id}::uuid and firm_id = ${firmId}::uuid`;
        } catch {
          // ignore — we still return the freshly-extracted text below
        }
      }
      if (gotText) {
        const clip = res.text.trim().slice(0, budget);
        budget -= clip.length;
        out.push({ name: d.name, text: clip });
      } else {
        // Bytes present but nothing extractable (blank scan OCR failed, etc.).
        unreadable.push(d.name);
      }
    }
    return { items: out, unreadable };
  },
};
