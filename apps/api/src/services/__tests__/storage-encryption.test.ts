import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { storage } from '../storage.service';
import { decryptFile, encryptFile, isEncryptedFile } from '../../lib/field-crypto';

// Uploaded documents are encrypted on disk (AES-256-GCM) and decrypted only
// when the API reads them back for a signed download.
const h = vi.hoisted(() => ({ dir: '', key: null as Buffer | null, isProd: false }));
h.dir = `${process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'}/difai-enc-test-${Date.now()}`;
h.key = Buffer.alloc(32, 7);

vi.mock('../../env', async (orig) => {
  const actual = (await orig()) as { env: Record<string, unknown> };
  return {
    env: new Proxy(actual.env, {
      get(t, p) {
        if (p === 'STORAGE_DRIVER') return 'local';
        if (p === 'STORAGE_LOCAL_DIR') return h.dir;
        if (p === 'fieldEncryptionKey') return h.key;
        if (p === 'isProd') return h.isProd;
        return t[p as string];
      },
    }),
  };
});

const PDF = Buffer.concat([Buffer.from('%PDF-1.7 Case brief: State v. Kumar, Crl.O.P. 1234/2026'), randomBytes(2048)]);

afterAll(async () => {
  await fs.rm(h.dir, { recursive: true, force: true });
});

describe('Document encryption at rest', () => {
  it('stores an uploaded document encrypted, never as plaintext', async () => {
    const key = 'documents/firm-1/brief.pdf';
    await storage().putObject({ key, body: PDF, contentType: 'application/pdf' });
    const onDisk = await fs.readFile(path.join(h.dir, key));
    expect(isEncryptedFile(onDisk)).toBe(true);
    expect(onDisk.includes(Buffer.from('State v. Kumar'))).toBe(false);
    expect(onDisk.equals(PDF)).toBe(false);
  });

  it('returns the original bytes when the API reads it for a download', async () => {
    const key = 'documents/firm-1/brief2.pdf';
    await storage().putObject({ key, body: PDF, contentType: 'application/pdf' });
    const obj = await storage().getObject(key);
    expect(obj?.body.equals(PDF)).toBe(true);
    expect(obj?.contentType).toBe('application/pdf');
  });

  it('encrypts the same file differently each time (fresh IV)', () => {
    expect(encryptFile(PDF, h.key!).equals(encryptFile(PDF, h.key!))).toBe(false);
  });

  it('still opens documents uploaded before encryption (legacy plaintext)', async () => {
    const key = 'documents/firm-1/old.pdf';
    await fs.mkdir(path.join(h.dir, 'documents/firm-1'), { recursive: true });
    await fs.writeFile(path.join(h.dir, key), PDF);
    const obj = await storage().getObject(key);
    expect(obj?.body.equals(PDF)).toBe(true);
  });

  it('refuses a tampered file instead of serving altered bytes', async () => {
    const key = 'documents/firm-1/tampered.pdf';
    await storage().putObject({ key, body: PDF, contentType: 'application/pdf' });
    const p = path.join(h.dir, key);
    const buf = await fs.readFile(p);
    buf.writeUInt8(buf.readUInt8(buf.length - 1) ^ 0xff, buf.length - 1);
    await fs.writeFile(p, buf);
    await expect(storage().getObject(key)).rejects.toThrow();
  });

  it('cannot be read with a different key', () => {
    const sealed = encryptFile(PDF, h.key!);
    expect(() => decryptFile(sealed, Buffer.alloc(32, 9))).toThrow();
  });

  it('handles an empty file', () => {
    expect(decryptFile(encryptFile(Buffer.alloc(0), h.key!), h.key!).length).toBe(0);
  });

  it('production without a key refuses to store the file in the clear', async () => {
    h.key = null;
    h.isProd = true;
    try {
      await expect(
        storage().putObject({ key: 'documents/firm-1/nokey.pdf', body: PDF, contentType: 'application/pdf' }),
      ).rejects.toThrow(/FIELD_ENCRYPTION_KEY/);
      await expect(fs.access(path.join(h.dir, 'documents/firm-1/nokey.pdf'))).rejects.toThrow();
    } finally {
      h.key = Buffer.alloc(32, 7);
      h.isProd = false;
    }
  });
});
