import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from '../db/client';
import { logger } from '../logger';
import { storage } from './storage.service';

// Secure share links (build-docs/features/secure-share-link.md).
// The client gets /s/<token>. Only sha256(token) is stored, so the table never
// holds a usable link. Each link has its own copy of the file under shares/
// (encrypted at rest by the storage driver), so it outlives edits or deletion
// of the source document until it expires.

type Sql = NonNullable<ReturnType<typeof db>>;
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SHARE_DAYS = [1, 7, 30] as const;
export const MAX_SHARE_BYTES = 25 * 1024 * 1024;
export const MAX_FAILED_ATTEMPTS = 5;
export const MAX_ACTIVE_LINKS_PER_FIRM = 200;

export class ShareLinkError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 404 | 503) {
    super(message);
  }
}

/** One message for unknown, expired, revoked and locked links: no hint which. */
const NOT_AVAILABLE = () => new ShareLinkError('This link is not available. Ask the sender for a new one.', 404);

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${(await scrypt(pw, salt, 32)).toString('base64')}`;
}

export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, saltB64, hashB64] = stored.split('$');
  if (kind !== 'scrypt' || !saltB64 || !hashB64) return false;
  const want = Buffer.from(hashB64, 'base64');
  const got = await scrypt(pw, Buffer.from(saltB64, 'base64'), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

function need(sql: Sql | null): Sql {
  if (!sql) throw new ShareLinkError('Secure links need the database', 503);
  return sql;
}

export interface CreateShareInput {
  firmId: string;
  userId: string | null;
  body: Buffer;
  fileName: string;
  contentType: string;
  days: number;
  password?: string | null;
}

export interface ShareLinkRow {
  id: string;
  file_name: string;
  file_size: string | number;
  has_password: boolean;
  expires_at: Date;
  revoked_at: Date | null;
  view_count: number;
  last_viewed_at: Date | null;
  created_at: Date;
}

export const shareLinksService = {
  async create(input: CreateShareInput, sql: Sql | null = db()): Promise<{ id: string; token: string; expiresAt: Date }> {
    const q = need(sql);
    if (!input.body.length) throw new ShareLinkError('Empty file', 400);
    if (input.body.length > MAX_SHARE_BYTES) throw new ShareLinkError('File is larger than 25 MB', 400);
    if (!(SHARE_DAYS as readonly number[]).includes(input.days)) throw new ShareLinkError('Expiry must be 1, 7 or 30 days', 400);
    const pw = input.password ?? '';
    if (pw && (pw.length < 4 || pw.length > 64)) throw new ShareLinkError('Password must be 4 to 64 characters', 400);
    const fileName = input.fileName.replace(/[\r\n"\\/]+/g, ' ').trim().slice(0, 200) || 'document';

    const [{ n } = { n: 0 }] = await q<{ n: number }[]>`
      select count(*)::int as n from share_links
      where firm_id = ${input.firmId}::uuid and revoked_at is null and expires_at > now()
    `;
    if (n >= MAX_ACTIVE_LINKS_PER_FIRM) throw new ShareLinkError('Too many active links. Revoke some old ones first.', 400);

    const token = randomBytes(32).toString('base64url');
    const key = `shares/${input.firmId}/${randomBytes(12).toString('hex')}`;
    await storage().putObject({ key, body: input.body, contentType: input.contentType });
    try {
      const [row] = await q<{ id: string; expires_at: Date }[]>`
        insert into share_links (firm_id, created_by, token_hash, storage_key, file_name, content_type, file_size, password_hash, expires_at)
        values (${input.firmId}::uuid, ${input.userId}, ${hashToken(token)}, ${key}, ${fileName}, ${input.contentType},
                ${input.body.length}, ${pw ? await hashPassword(pw) : null}, now() + make_interval(days => ${input.days}))
        returning id, expires_at
      `;
      return { id: row!.id, token, expiresAt: row!.expires_at };
    } catch (err) {
      await storage().delete(key).catch(() => undefined);
      throw err;
    }
  },

  async list(firmId: string, sql: Sql | null = db()): Promise<ShareLinkRow[]> {
    return need(sql)<ShareLinkRow[]>`
      select id, file_name, file_size, password_hash is not null as has_password,
             expires_at, revoked_at, view_count, last_viewed_at, created_at
      from share_links where firm_id = ${firmId}::uuid
      order by created_at desc limit 100
    `;
  },

  /** Firm-scoped: another firm's link id simply isn't found. */
  async revoke(id: string, firmId: string, sql: Sql | null = db()): Promise<boolean> {
    const rows = await need(sql)`
      update share_links set revoked_at = coalesce(revoked_at, now())
      where id::text = ${id} and firm_id = ${firmId}::uuid returning id
    `;
    return rows.length > 0;
  },

  /** Public: what the open page shows before the file is fetched. */
  async meta(token: string, sql: Sql | null = db()) {
    const [row] = await need(sql)<{ file_name: string; file_size: string; has_password: boolean; expires_at: Date }[]>`
      select file_name, file_size, password_hash is not null as has_password, expires_at
      from share_links
      where token_hash = ${hashToken(token)} and revoked_at is null and expires_at > now()
        and failed_attempts < ${MAX_FAILED_ATTEMPTS} and storage_key is not null
    `;
    if (!row) throw NOT_AVAILABLE();
    return { fileName: row.file_name, fileSize: Number(row.file_size), needsPassword: row.has_password, expiresAt: row.expires_at };
  },

  /** Public: check the password, count the view, return the decrypted file. */
  async open(token: string, password: string | undefined, sql: Sql | null = db()) {
    const q = need(sql);
    const th = hashToken(token);
    const [row] = await q<{ id: string; storage_key: string; file_name: string; content_type: string; password_hash: string | null }[]>`
      select id, storage_key, file_name, content_type, password_hash from share_links
      where token_hash = ${th} and revoked_at is null and expires_at > now()
        and failed_attempts < ${MAX_FAILED_ATTEMPTS} and storage_key is not null
    `;
    if (!row) throw NOT_AVAILABLE();
    if (row.password_hash && !(await checkPassword(password ?? '', row.password_hash))) {
      // Single UPDATE so parallel guesses can't slip past the limit.
      const [after] = await q<{ failed_attempts: number }[]>`
        update share_links set failed_attempts = failed_attempts + 1 where id = ${row.id} returning failed_attempts
      `;
      if ((after?.failed_attempts ?? MAX_FAILED_ATTEMPTS) >= MAX_FAILED_ATTEMPTS) throw NOT_AVAILABLE();
      throw new ShareLinkError('Wrong password', 401);
    }
    const file = await storage().getObject(row.storage_key);
    if (!file) throw NOT_AVAILABLE();
    await q`update share_links set view_count = view_count + 1, last_viewed_at = now() where id = ${row.id}`;
    return { body: file.body, fileName: row.file_name, contentType: row.content_type };
  },

  /** Daily: delete the file copies of links that expired or were revoked over a day ago. */
  async sweep(sql: Sql | null = db()): Promise<number> {
    const q = need(sql);
    const rows = await q<{ id: string; storage_key: string }[]>`
      select id, storage_key from share_links
      where file_deleted_at is null and storage_key is not null
        and (expires_at < now() or revoked_at < now() - interval '1 day')
      limit 500
    `;
    for (const r of rows) {
      try {
        await storage().delete(r.storage_key);
        await q`update share_links set storage_key = null, file_deleted_at = now() where id = ${r.id}`;
      } catch (err) {
        logger.warn({ err, id: r.id }, 'share link file delete failed');
      }
    }
    return rows.length;
  },
};
