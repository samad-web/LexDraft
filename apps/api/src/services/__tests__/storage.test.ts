import { describe, expect, it } from 'vitest';
import { storage, verifyLocalUploadUrl } from '../storage.service';

describe('storage (local driver) presigned URL signing', () => {
  it('round-trips a PUT presigned URL', async () => {
    const presigned = await storage().presignUpload({
      key: 'documents/firm-1/test.txt',
      contentType: 'text/plain',
    });
    const url = new URL(presigned.uploadUrl);
    const exp = url.searchParams.get('exp')!;
    const sig = url.searchParams.get('sig')!;
    const ct = url.searchParams.get('ct')!;
    const verdict = verifyLocalUploadUrl({ method: 'PUT', key: presigned.key, contentType: ct, exp, sig });
    expect(verdict).toEqual({ ok: true });
  });

  it('rejects a tampered signature', async () => {
    const presigned = await storage().presignUpload({
      key: 'documents/firm-1/test.txt',
      contentType: 'text/plain',
    });
    const url = new URL(presigned.uploadUrl);
    const exp = url.searchParams.get('exp')!;
    const ct = url.searchParams.get('ct')!;
    const verdict = verifyLocalUploadUrl({
      method: 'PUT',
      key: presigned.key,
      contentType: ct,
      exp,
      sig: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
    expect(verdict.ok).toBe(false);
  });

  it('rejects a different content type than the URL was signed for', async () => {
    const presigned = await storage().presignUpload({
      key: 'documents/firm-1/test.txt',
      contentType: 'text/plain',
    });
    const url = new URL(presigned.uploadUrl);
    const exp = url.searchParams.get('exp')!;
    const sig = url.searchParams.get('sig')!;
    const verdict = verifyLocalUploadUrl({
      method: 'PUT',
      key: presigned.key,
      contentType: 'application/pdf', // not what was signed
      exp,
      sig,
    });
    expect(verdict.ok).toBe(false);
  });

  it('rejects expired URLs', async () => {
    const verdict = verifyLocalUploadUrl({
      method: 'GET',
      key: 'a',
      contentType: undefined,
      exp: '1', // 1970-01-01
      sig: 'x',
    });
    expect(verdict).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects path-traversal keys', async () => {
    await expect(
      storage().presignUpload({ key: '../etc/passwd', contentType: 'text/plain' }),
    ).rejects.toThrow(/Invalid storage key/);
  });

  it('round-trips put/get for a small object', async () => {
    const key = `tests/round-trip-${Date.now()}.txt`;
    await storage().putObject({
      key,
      body: Buffer.from('hello, lexdraft'),
      contentType: 'text/plain',
    });
    const obj = await storage().getObject(key);
    expect(obj?.body.toString()).toBe('hello, lexdraft');
    expect(obj?.contentType).toBe('text/plain');
    await storage().delete(key);
    expect(await storage().getObject(key)).toBeNull();
  });
});
