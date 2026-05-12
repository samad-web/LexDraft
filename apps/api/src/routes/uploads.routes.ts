import { Router, raw } from 'express';
import { logger } from '../logger';
import { storage, verifyLocalUploadUrl } from '../services/storage.service';

/**
 * Local-driver upload/download endpoints. Each request is authenticated by the
 * HMAC signature embedded in the URL, NOT by the bearer token — this matches
 * how S3/R2 presigned URLs work, so migrating drivers later doesn't require
 * client changes. The handlers are intentionally not under requireAuth.
 */
export const uploadsRouter: Router = Router();

// 25 MB cap — generous for legal documents (briefs, exhibits) but bounded
// so a malicious client can't fill the disk in one PUT.
const MAX_BYTES = 25 * 1024 * 1024;

uploadsRouter.put(
  '/:key(*)',
  raw({ type: '*/*', limit: MAX_BYTES }),
  async (req, res) => {
    const params = req.params as Record<string, string>;
    const key = params['key'] ?? '';
    const exp = typeof req.query['exp'] === 'string' ? req.query['exp'] : '';
    const sig = typeof req.query['sig'] === 'string' ? req.query['sig'] : '';
    const ctParam = typeof req.query['ct'] === 'string' ? req.query['ct'] : '';
    const headerCt = req.header('content-type') ?? '';

    if (!sig || !exp) {
      res.status(400).json({ error: 'Missing signature' });
      return;
    }
    if (ctParam && headerCt && headerCt.split(';')[0]!.trim() !== ctParam) {
      res.status(400).json({ error: 'Content-Type does not match presigned URL' });
      return;
    }
    const verdict = verifyLocalUploadUrl({ method: 'PUT', key, contentType: ctParam, exp, sig });
    if (!verdict.ok) {
      res.status(403).json({ error: `Forbidden: ${verdict.reason}` });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Empty body' });
      return;
    }
    try {
      await storage().putObject({ key, body: req.body, contentType: ctParam || headerCt || 'application/octet-stream' });
      res.status(204).end();
    } catch (err) {
      logger.error({ err, key }, 'upload write failed');
      res.status(500).json({ error: 'Upload failed' });
    }
  },
);

uploadsRouter.get('/:key(*)', async (req, res) => {
  const params = req.params as Record<string, string>;
  const key = params['key'] ?? '';
  const exp = typeof req.query['exp'] === 'string' ? req.query['exp'] : '';
  const sig = typeof req.query['sig'] === 'string' ? req.query['sig'] : '';

  const verdict = verifyLocalUploadUrl({ method: 'GET', key, contentType: undefined, exp, sig });
  if (!verdict.ok) {
    res.status(403).json({ error: `Forbidden: ${verdict.reason}` });
    return;
  }
  const obj = await storage().getObject(key);
  if (!obj) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  res.setHeader('Content-Type', obj.contentType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(obj.body);
});
