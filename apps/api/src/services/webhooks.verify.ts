import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { env } from '../env';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Raw request bytes - set by the express.json `verify` callback in
       *  app.ts so webhook handlers can verify signatures against the exact
       *  payload the provider signed. */
      rawBody?: Buffer;
    }
  }
}

export type WebhookVerifyResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

/**
 * Verifies a `:source`-keyed inbound webhook against the per-provider
 * HMAC-SHA256 secret configured in env (`WEBHOOK_SECRET_<UPPERCASE>`).
 *
 * Expected header: `x-signature: sha256=<hex>` - the provider hashes the
 * raw request bytes with the shared secret. Comparison is timing-safe.
 *
 * Sources without a configured secret are rejected with 503 unless the
 * operator has opted into `WEBHOOK_ALLOW_UNVERIFIED=true` in a non-prod
 * environment (NODE_ENV='production' forces the flag off).
 */
export function verifyWebhook(req: Request, source: string): WebhookVerifyResult {
  const secret = env.webhookSecrets[source];

  if (!secret) {
    if (env.webhookAllowUnverified) return { ok: true };
    return { ok: false, status: 503, reason: `No webhook secret configured for source "${source}"` };
  }

  // Header is "sha256=<hex>" per the GitHub/Stripe convention.
  // We accept either with or without the prefix to be tolerant of providers
  // that ship raw hex.
  const headerVal = req.header('x-signature') ?? '';
  const supplied = headerVal.startsWith('sha256=') ? headerVal.slice('sha256='.length) : headerVal;
  if (!supplied || !/^[0-9a-fA-F]+$/.test(supplied)) {
    return { ok: false, status: 401, reason: 'Missing or malformed x-signature header' };
  }

  const rawBody = req.rawBody ?? Buffer.alloc(0);
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  // timingSafeEqual requires equal-length buffers - bail before the
  // comparison if lengths differ so we don't throw.
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(supplied, 'hex');
  if (a.length !== b.length) {
    return { ok: false, status: 401, reason: 'Signature length mismatch' };
  }
  if (!timingSafeEqual(a, b)) {
    return { ok: false, status: 401, reason: 'Signature verification failed' };
  }

  return { ok: true };
}
