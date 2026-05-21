import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env';

export interface PresignedUpload {
  /** URL the client PUTs the binary body to. */
  uploadUrl: string;
  /** Opaque storage key the API records on the document row. */
  key: string;
  /** ISO timestamp the URL stops being valid. */
  expiresAt: string;
  /** When using the local driver the client must include this exact mime in
   *  the PUT's Content-Type header - the signature covers it. */
  requiredContentType: string;
}

export interface PresignedDownload {
  downloadUrl: string;
  expiresAt: string;
}

export interface StorageDriver {
  presignUpload(input: { key: string; contentType: string; expiresInSec?: number }): Promise<PresignedUpload>;
  presignDownload(input: { key: string; expiresInSec?: number }): Promise<PresignedDownload>;
  /** Server-side write - used by code paths that already hold the bytes
   *  (e.g. document-template renderers). */
  putObject(input: { key: string; body: Buffer; contentType: string }): Promise<void>;
  /** Server-side read - used by the local-driver signed-GET handler and by
   *  background jobs that need to pull the bytes themselves. */
  getObject(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Local-disk driver. Files are written under STORAGE_LOCAL_DIR; presigned URLs
// point back at /api/uploads/<key> on this same API process and are HMAC-
// signed so the upload route can verify them without a session.
// ---------------------------------------------------------------------------

const DEFAULT_EXPIRES_SEC = 15 * 60;

function sign(parts: string[], secret: string): string {
  const h = crypto.createHmac('sha256', secret);
  for (const p of parts) h.update(p).update('\0');
  return h.digest('base64url');
}

function verify(parts: string[], secret: string, signature: string): boolean {
  const expected = sign(parts, secret);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function safeKey(key: string): string {
  // Reject path-traversal and control characters; allow [a-zA-Z0-9/_.-].
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key)) throw new Error('Invalid storage key');
  if (key.includes('..')) throw new Error('Invalid storage key');
  return key;
}

function localDriver(): StorageDriver {
  const root = path.resolve(env.STORAGE_LOCAL_DIR);
  const ensureRoot = fs.mkdir(root, { recursive: true }).catch(() => undefined);

  async function abs(key: string): Promise<string> {
    await ensureRoot;
    const safe = safeKey(key);
    const p = path.resolve(root, safe);
    if (!p.startsWith(root + path.sep) && p !== root) throw new Error('Storage key escapes root');
    return p;
  }

  return {
    async presignUpload({ key, contentType, expiresInSec }) {
      const safe = safeKey(key);
      const exp = Math.floor(Date.now() / 1000) + (expiresInSec ?? DEFAULT_EXPIRES_SEC);
      const sig = sign(['PUT', safe, contentType, String(exp)], env.storageSigningSecret);
      const url = `${env.storagePublicBaseUrl}/api/uploads/${encodeURI(safe)}` +
        `?ct=${encodeURIComponent(contentType)}&exp=${exp}&sig=${sig}`;
      return {
        uploadUrl: url,
        key: safe,
        expiresAt: new Date(exp * 1000).toISOString(),
        requiredContentType: contentType,
      };
    },

    async presignDownload({ key, expiresInSec }) {
      const safe = safeKey(key);
      const exp = Math.floor(Date.now() / 1000) + (expiresInSec ?? DEFAULT_EXPIRES_SEC);
      const sig = sign(['GET', safe, String(exp)], env.storageSigningSecret);
      const url = `${env.storagePublicBaseUrl}/api/uploads/${encodeURI(safe)}` +
        `?exp=${exp}&sig=${sig}`;
      return { downloadUrl: url, expiresAt: new Date(exp * 1000).toISOString() };
    },

    async putObject({ key, body, contentType }) {
      const p = await abs(key);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, body);
      await fs.writeFile(p + '.meta', JSON.stringify({ contentType }));
    },

    async getObject(key) {
      try {
        const p = await abs(key);
        const [body, metaRaw] = await Promise.all([
          fs.readFile(p),
          fs.readFile(p + '.meta', 'utf8').catch(() => '{}'),
        ]);
        const meta = JSON.parse(metaRaw) as { contentType?: string };
        return { body, contentType: meta.contentType ?? 'application/octet-stream' };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },

    async delete(key) {
      const p = await abs(key);
      await Promise.all([
        fs.rm(p, { force: true }),
        fs.rm(p + '.meta', { force: true }),
      ]);
    },
  };
}

// ---------------------------------------------------------------------------
// S3 / R2 driver (same shape — R2 is just S3 with a custom endpoint + path-
// style URLs). Requires the storage env block in env.ts to be set:
//   STORAGE_S3_BUCKET, STORAGE_S3_REGION, STORAGE_S3_ACCESS_KEY_ID,
//   STORAGE_S3_SECRET_ACCESS_KEY, and (R2 only) STORAGE_S3_ENDPOINT +
//   STORAGE_S3_FORCE_PATH_STYLE=true.
// ---------------------------------------------------------------------------

function s3Driver(): StorageDriver {
  // Lazy-import the AWS SDK so dev installs that never set STORAGE_DRIVER=s3
  // don't pay the cold-start tax. The require() call only runs when the
  // operator opted into S3.
  type S3Client = import('@aws-sdk/client-s3').S3Client;
  let clientPromise: Promise<S3Client> | null = null;

  async function getClient(): Promise<S3Client> {
    if (clientPromise) return clientPromise;
    clientPromise = (async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      if (!env.STORAGE_S3_BUCKET || !env.STORAGE_S3_REGION) {
        throw new Error('S3 driver requires STORAGE_S3_BUCKET and STORAGE_S3_REGION');
      }
      return new S3Client({
        region: env.STORAGE_S3_REGION,
        credentials: env.STORAGE_S3_ACCESS_KEY_ID && env.STORAGE_S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID,
              secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY,
            }
          : undefined,
          ...(env.STORAGE_S3_ENDPOINT ? { endpoint: env.STORAGE_S3_ENDPOINT } : {}),
        forcePathStyle: env.storageS3ForcePathStyle,
      });
    })();
    return clientPromise;
  }

  return {
    async presignUpload({ key, contentType, expiresInSec }) {
      const safe = safeKey(key);
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const client = await getClient();
      const cmd = new PutObjectCommand({
        Bucket: env.STORAGE_S3_BUCKET,
        Key: safe,
        ContentType: contentType,
      });
      const expSec = expiresInSec ?? DEFAULT_EXPIRES_SEC;
      const url = await getSignedUrl(client, cmd, { expiresIn: expSec });
      return {
        uploadUrl: url,
        key: safe,
        expiresAt: new Date(Date.now() + expSec * 1000).toISOString(),
        requiredContentType: contentType,
      };
    },

    async presignDownload({ key, expiresInSec }) {
      const safe = safeKey(key);
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const client = await getClient();
      const cmd = new GetObjectCommand({ Bucket: env.STORAGE_S3_BUCKET, Key: safe });
      const expSec = expiresInSec ?? DEFAULT_EXPIRES_SEC;
      const url = await getSignedUrl(client, cmd, { expiresIn: expSec });
      return { downloadUrl: url, expiresAt: new Date(Date.now() + expSec * 1000).toISOString() };
    },

    async putObject({ key, body, contentType }) {
      const safe = safeKey(key);
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const client = await getClient();
      await client.send(new PutObjectCommand({
        Bucket: env.STORAGE_S3_BUCKET,
        Key: safe,
        Body: body,
        ContentType: contentType,
      }));
    },

    async getObject(key) {
      const safe = safeKey(key);
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const client = await getClient();
      try {
        const res = await client.send(new GetObjectCommand({
          Bucket: env.STORAGE_S3_BUCKET,
          Key: safe,
        }));
        const stream = res.Body as NodeJS.ReadableStream | undefined;
        if (!stream) return null;
        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(c as Buffer);
        return {
          body: Buffer.concat(chunks),
          contentType: res.ContentType ?? 'application/octet-stream',
        };
      } catch (err) {
        if ((err as { name?: string }).name === 'NoSuchKey') return null;
        throw err;
      }
    },

    async delete(key) {
      const safe = safeKey(key);
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const client = await getClient();
      await client.send(new DeleteObjectCommand({
        Bucket: env.STORAGE_S3_BUCKET,
        Key: safe,
      }));
    },
  };
}

let cached: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (cached) return cached;
  switch (env.STORAGE_DRIVER) {
    case 'local': cached = localDriver(); break;
    case 's3':
    case 'r2':    cached = s3Driver(); break;
  }
  return cached!;
}

// Exported for the upload route - not part of the StorageDriver interface
// because S3/R2 do verification on their side, not ours.
export function verifyLocalUploadUrl(input: {
  method: 'GET' | 'PUT';
  key: string;
  contentType: string | undefined;
  exp: string;
  sig: string;
}): { ok: true } | { ok: false; reason: string } {
  if (env.STORAGE_DRIVER !== 'local') return { ok: false, reason: 'wrong driver' };
  const expNum = Number(input.exp);
  if (!Number.isFinite(expNum) || expNum * 1000 < Date.now()) return { ok: false, reason: 'expired' };
  const parts = input.method === 'PUT'
    ? ['PUT', input.key, input.contentType ?? '', input.exp]
    : ['GET', input.key, input.exp];
  if (!verify(parts, env.storageSigningSecret, input.sig)) return { ok: false, reason: 'bad signature' };
  return { ok: true };
}
