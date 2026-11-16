import { Router, raw, type NextFunction, type Response } from 'express';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { MAX_SHARE_BYTES, ShareLinkError, shareLinksService } from '../services/share-links.service';

// Secure share links (build-docs/features/secure-share-link.md).

function fail(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ShareLinkError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

function decodeHeader(v: string | undefined): string {
  try {
    return decodeURIComponent(v ?? '');
  } catch {
    return '';
  }
}

/** Signed-in advocates: create, list, revoke. Mounted behind requireAuth. */
export const shareLinksRouter: Router = Router();

// Body = the file bytes (any type). Name URI-encoded in X-Share-Name, expiry in
// X-Share-Days (1/7/30), optional password in X-Share-Password (redacted in logs).
shareLinksRouter.post(
  '/',
  requireFeature('shared.documents'),
  raw({ type: () => true, limit: MAX_SHARE_BYTES }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) {
        res.status(422).json({ error: 'No firm attached' });
        return;
      }
      if (!Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: 'Send the file as the request body' });
        return;
      }
      const link = await shareLinksService.create({
        firmId,
        userId: req.user?.id ?? null,
        body: req.body,
        fileName: decodeHeader(req.header('x-share-name')) || 'document',
        contentType: (req.header('content-type') || 'application/octet-stream').split(';')[0]!.trim(),
        days: Number(req.header('x-share-days') || 7),
        password: req.header('x-share-password') || null,
      });
      res.status(201).json({ id: link.id, token: link.token, expiresAt: link.expiresAt });
    } catch (err) {
      fail(err, res, next);
    }
  },
);

shareLinksRouter.get('/', requireFeature('shared.documents'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    if (!firmId) {
      res.json([]);
      return;
    }
    const rows = await shareLinksService.list(firmId);
    res.json(rows.map((r) => ({
      id: r.id,
      fileName: r.file_name,
      fileSize: Number(r.file_size),
      hasPassword: r.has_password,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
      viewCount: r.view_count,
      lastViewedAt: r.last_viewed_at,
      createdAt: r.created_at,
    })));
  } catch (err) {
    fail(err, res, next);
  }
});

shareLinksRouter.post('/:id/revoke', requireFeature('shared.documents'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const ok = firmId ? await shareLinksService.revoke(String(req.params['id']), firmId) : false;
    if (!ok) {
      res.status(404).json({ error: 'Link not found' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    fail(err, res, next);
  }
});

/** Public (no sign-in): the client opening /s#<token>. Rate limited where mounted.
 *  The token travels in the JSON body (redacted from logs as req.body.token), never
 *  in a URL, so no access log (app or nginx) ever records a usable link. */
export const publicShareRouter: Router = Router();

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const tokenOf = (body: unknown): string => {
  const t = (body as { token?: unknown } | undefined)?.token;
  return typeof t === 'string' ? t : '';
};

publicShareRouter.post('/meta', async (req, res, next) => {
  try {
    const token = tokenOf(req.body);
    if (!TOKEN.test(token)) throw new ShareLinkError('This link is not available. Ask the sender for a new one.', 404);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await shareLinksService.meta(token));
  } catch (err) {
    fail(err, res, next);
  }
});

publicShareRouter.post('/open', async (req, res, next) => {
  try {
    const token = tokenOf(req.body);
    if (!TOKEN.test(token)) throw new ShareLinkError('This link is not available. Ask the sender for a new one.', 404);
    const pw = typeof req.body?.password === 'string' ? req.body.password : undefined;
    const file = await shareLinksService.open(token, pw);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.body);
  } catch (err) {
    fail(err, res, next);
  }
});
