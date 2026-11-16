import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MAX_FAILED_ATTEMPTS, ShareLinkError, checkPassword, hashPassword, hashToken, shareLinksService,
} from '../share-links.service';

// Secure share links (features/secure-share-link.md). Runs against the LOCAL dev
// Postgres (apps/api/.env must point at localhost:5433, with 0111 applied).
// Every test runs inside a transaction that is rolled back: nothing is left behind.

function localDbUrl(): string {
  const env = fs.readFileSync(path.resolve(__dirname, '../../../.env'), 'utf8');
  const url = /^DATABASE_URL=(.+)$/m.exec(env)?.[1]?.trim() ?? '';
  if (!/@localhost:5433\//.test(url)) throw new Error('share-links tests need the local dev DB (localhost:5433)');
  return url;
}

const sql = postgres(localDbUrl(), { max: 2, onnotice: () => undefined });
afterAll(() => sql.end());

type Tx = postgres.TransactionSql;
/** The service takes the app's Sql; a transaction behaves the same for these queries. */
type Db = NonNullable<Parameters<typeof shareLinksService.list>[1]>;
const T = (tx: Tx) => tx as unknown as Db;
const ROLLBACK = new Error('rollback');

/** Run fn with a fresh firm inside a transaction that is always rolled back. */
async function inTx(fn: (tx: Tx, firmId: string) => Promise<void>) {
  await sql.begin(async (tx: Tx) => {
    const [firm] = await tx<{ id: string }[]>`insert into firms (name) values ('share-links test firm') returning id`;
    await fn(tx, firm!.id);
    throw ROLLBACK;
  }).catch((err) => {
    if (err !== ROLLBACK) throw err;
  });
}

const PDF = Buffer.from('%PDF-1.7 brief for the client');
const make = (tx: Tx, firmId: string, extra: Partial<Parameters<typeof shareLinksService.create>[0]> = {}) =>
  shareLinksService.create({
    firmId, userId: null, body: PDF, fileName: 'Brief.pdf', contentType: 'application/pdf', days: 7, ...extra,
  }, T(tx));

describe('Secure share link', () => {
  it('opens the exact file before expiry and counts the view', async () => {
    await inTx(async (tx, firmId) => {
      const { token, expiresAt } = await make(tx, firmId);
      expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
      const meta = await shareLinksService.meta(token, T(tx));
      expect(meta).toMatchObject({ fileName: 'Brief.pdf', fileSize: PDF.length, needsPassword: false });
      const file = await shareLinksService.open(token, undefined, T(tx));
      expect(file.body.equals(PDF)).toBe(true);
      expect(file.contentType).toBe('application/pdf');
      const [row] = await shareLinksService.list(firmId, T(tx));
      expect(row!.view_count).toBe(1);
      expect(row!.last_viewed_at).not.toBeNull();
    });
  });

  it('stores only a hash of the token: the table holds no usable link', async () => {
    await inTx(async (tx, firmId) => {
      const { id, token } = await make(tx, firmId);
      const [row] = await tx<{ token_hash: string }[]>`select token_hash from share_links where id = ${id}`;
      expect(row!.token_hash).toBe(hashToken(token));
      expect(row!.token_hash).not.toContain(token);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });
  });

  it('refuses after expiry with the generic message', async () => {
    await inTx(async (tx, firmId) => {
      const { id, token } = await make(tx, firmId);
      await tx`update share_links set expires_at = now() - interval '1 minute' where id = ${id}`;
      await expect(shareLinksService.meta(token, T(tx))).rejects.toMatchObject({ status: 404 });
      await expect(shareLinksService.open(token, undefined, T(tx))).rejects.toThrow(/not available/);
    });
  });

  it('refuses after the advocate revokes it', async () => {
    await inTx(async (tx, firmId) => {
      const { id, token } = await make(tx, firmId);
      expect(await shareLinksService.revoke(id, firmId, T(tx))).toBe(true);
      await expect(shareLinksService.open(token, undefined, T(tx))).rejects.toMatchObject({ status: 404 });
    });
  });

  it("another firm cannot see or revoke the link", async () => {
    await inTx(async (tx, firmId) => {
      const { id, token } = await make(tx, firmId);
      const [other] = await tx<{ id: string }[]>`insert into firms (name) values ('other firm') returning id`;
      expect(await shareLinksService.list(other!.id, T(tx))).toEqual([]);
      expect(await shareLinksService.revoke(id, other!.id, T(tx))).toBe(false);
      await expect(shareLinksService.meta(token, T(tx))).resolves.toBeTruthy();
    });
  });

  it('password link: refuses without or with a wrong password, opens with the right one', async () => {
    await inTx(async (tx, firmId) => {
      const { id, token } = await make(tx, firmId, { password: '482913' });
      expect((await shareLinksService.meta(token, T(tx))).needsPassword).toBe(true);
      await expect(shareLinksService.open(token, undefined, T(tx))).rejects.toMatchObject({ status: 401 });
      await expect(shareLinksService.open(token, '000000', T(tx))).rejects.toMatchObject({ status: 401 });
      const file = await shareLinksService.open(token, '482913', T(tx));
      expect(file.body.equals(PDF)).toBe(true);
      const [row] = await tx<{ password_hash: string }[]>`select password_hash from share_links where id = ${id}`;
      expect(row!.password_hash).not.toContain('482913');
    });
  });

  it(`locks the link after ${MAX_FAILED_ATTEMPTS} wrong passwords, even for the right one`, async () => {
    await inTx(async (tx, firmId) => {
      const { token } = await make(tx, firmId, { password: '482913' });
      for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
        await expect(shareLinksService.open(token, 'wrong', T(tx))).rejects.toMatchObject({ status: 401 });
      }
      await expect(shareLinksService.open(token, 'wrong', T(tx))).rejects.toMatchObject({ status: 404 });
      await expect(shareLinksService.open(token, '482913', T(tx))).rejects.toMatchObject({ status: 404 });
    });
  });

  it('unknown token gets the same generic answer as an expired one', async () => {
    await inTx(async (tx) => {
      const err = await shareLinksService.meta('A'.repeat(43), T(tx)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ShareLinkError);
      expect((err as Error).message).toMatch(/not available/);
    });
  });

  it.each([
    ['an empty file', { body: Buffer.alloc(0) }, /Empty/],
    ['a file over 25 MB', { body: Buffer.alloc(25 * 1024 * 1024 + 1) }, /25 MB/],
    ['an expiry other than 1/7/30 days', { days: 365 }, /1, 7 or 30/],
    ['a 3-character password', { password: '123' }, /4 to 64/],
  ])('refuses %s', async (_l, extra, msg) => {
    await inTx(async (tx, firmId) => {
      await expect(make(tx, firmId, extra)).rejects.toThrow(msg);
    });
  });

  it('caps active links per firm', async () => {
    await inTx(async (tx, firmId) => {
      await tx`
        insert into share_links (firm_id, token_hash, storage_key, file_name, content_type, file_size, expires_at)
        select ${firmId}::uuid, 'h' || g, 'shares/x/' || g, 'f', 'application/pdf', 1, now() + interval '1 day'
        from generate_series(1, 200) g
      `;
      await expect(make(tx, firmId)).rejects.toThrow(/Too many active links/);
    });
  });

  it('nightly sweep deletes the file copy of an expired link', async () => {
    await inTx(async (tx, firmId) => {
      const { id } = await make(tx, firmId);
      await tx`update share_links set expires_at = now() - interval '1 hour' where id = ${id}`;
      expect(await shareLinksService.sweep(T(tx))).toBeGreaterThanOrEqual(1);
      const [row] = await tx<{ storage_key: string | null; file_deleted_at: Date | null }[]>`
        select storage_key, file_deleted_at from share_links where id = ${id}`;
      expect(row!.storage_key).toBeNull();
      expect(row!.file_deleted_at).not.toBeNull();
    });
  });

  it('password hashes are salted and verify only the right password', async () => {
    const a = await hashPassword('482913');
    expect(a).not.toBe(await hashPassword('482913'));
    expect(await checkPassword('482913', a)).toBe(true);
    expect(await checkPassword('482914', a)).toBe(false);
    expect(await checkPassword('482913', 'garbage')).toBe(false);
  });
});
