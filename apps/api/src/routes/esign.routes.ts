/**
 * Electronic signature routes.
 *
 * Self-built Section 3A "electronic signature" — NOT a Section 3 digital
 * signature or Aadhaar eSign (both require a licensed Certifying Authority
 * this product does not have; see 0079_esign.sql's header for the full
 * legal scope). Gated on `esign.send` (Practice+ tier — already seeded in
 * migration 0009_rbac.sql, this is the first real consumer of that flag).
 *
 * Split like co-counsel.routes.ts: the signer-facing accept/consent/OTP/
 * sign endpoints are public (token-scoped, rate-limited) because a signer
 * usually has no DifAi account; everything else requires an
 * authenticated firm member who sent the request.
 */

import { Router } from 'express';
import { z } from 'zod';
import { esignService } from '../services/esign.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { requireAuth } from '../middleware/auth';
import { validate, uuidParam } from '../middleware/validate';
import { tokenLookupLimiter } from '../middleware/rateLimit';

const TokenParam = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/, 'Invalid token shape'),
});

const CreateBody = z.object({
  title: z.string().min(1).max(300),
  sourceDocumentId: z.string().uuid(),
  caseId: z.string().uuid().optional(),
  documentTypeHint: z.string().max(100).optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
  signers: z.array(z.object({
    name: z.string().min(1).max(200),
    email: z.string().email(),
    userId: z.string().uuid().optional(),
    order: z.number().int().min(1).optional(),
  })).min(1).max(10),
});

const DeclineBody = z.object({
  reason: z.string().max(1000).optional(),
});

const VerifyOtpBody = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

function reqIp(req: { ip?: string; get: (h: string) => string | undefined }): { ip: string | null; ua: string | null } {
  return { ip: req.ip ?? null, ua: req.get('user-agent') ?? null };
}

export const esignRouter: Router = Router();

// ---- Public (token-scoped) --------------------------------------------------

esignRouter.get(
  '/by-token/:token',
  tokenLookupLimiter,
  validate({ params: TokenParam }),
  async (req, res, next) => {
    try {
      const token = (req.params as { token: string }).token;
      const resolved = await esignService.resolveToken(token);
      if (!resolved) { res.status(404).json({ error: 'Link is invalid or has expired' }); return; }
      const { ip, ua } = reqIp(req);
      await esignService.recordOpened(resolved.signer.id, resolved.request.id, ip, ua);
      res.json(resolved);
    } catch (err) { next(err); }
  },
);

esignRouter.post(
  '/by-token/:token/consent',
  tokenLookupLimiter,
  validate({ params: TokenParam }),
  async (req, res, next) => {
    try {
      const token = (req.params as { token: string }).token;
      const resolved = await esignService.resolveToken(token);
      if (!resolved) { res.status(404).json({ error: 'Link is invalid or has expired' }); return; }
      const { ip, ua } = reqIp(req);
      await esignService.provideConsent(resolved.signer.id, resolved.request.id, ip, ua);
      res.status(204).end();
    } catch (err) { next(err); }
  },
);

esignRouter.post(
  '/by-token/:token/otp',
  tokenLookupLimiter,
  validate({ params: TokenParam }),
  async (req, res, next) => {
    try {
      const token = (req.params as { token: string }).token;
      const resolved = await esignService.resolveToken(token);
      if (!resolved) { res.status(404).json({ error: 'Link is invalid or has expired' }); return; }
      const { ip, ua } = reqIp(req);
      await esignService.requestOtp(resolved.signer.id, resolved.request.id, ip, ua);
      res.status(202).json({ sent: true });
    } catch (err) { next(err); }
  },
);

esignRouter.post(
  '/by-token/:token/otp/verify',
  tokenLookupLimiter,
  validate({ params: TokenParam, body: VerifyOtpBody }),
  async (req, res, next) => {
    try {
      const token = (req.params as { token: string }).token;
      const resolved = await esignService.resolveToken(token);
      if (!resolved) { res.status(404).json({ error: 'Link is invalid or has expired' }); return; }
      const { code } = req.body as z.infer<typeof VerifyOtpBody>;
      const { ip, ua } = reqIp(req);
      const ok = await esignService.verifyOtp(resolved.signer.id, resolved.request.id, code, ip, ua);
      if (!ok) { res.status(400).json({ error: 'Incorrect or expired code' }); return; }
      res.json({ verified: true });
    } catch (err) { next(err); }
  },
);

esignRouter.post(
  '/by-token/:token/sign',
  tokenLookupLimiter,
  validate({ params: TokenParam }),
  async (req, res, next) => {
    try {
      const token = (req.params as { token: string }).token;
      const resolved = await esignService.resolveToken(token);
      if (!resolved) { res.status(404).json({ error: 'Link is invalid or has expired' }); return; }
      const { ip, ua } = reqIp(req);
      const request = await esignService.sign(resolved.signer.id, resolved.request.id, ip, ua);
      res.json(request);
    } catch (err) { next(err); }
  },
);

esignRouter.post(
  '/by-token/:token/decline',
  tokenLookupLimiter,
  validate({ params: TokenParam, body: DeclineBody }),
  async (req, res, next) => {
    try {
      const token = (req.params as { token: string }).token;
      const resolved = await esignService.resolveToken(token);
      if (!resolved) { res.status(404).json({ error: 'Link is invalid or has expired' }); return; }
      const { reason } = req.body as z.infer<typeof DeclineBody>;
      const { ip, ua } = reqIp(req);
      await esignService.decline(resolved.signer.id, resolved.request.id, reason ?? null, ip, ua);
      res.status(204).end();
    } catch (err) { next(err); }
  },
);

// ---- Authenticated -----------------------------------------------------------

esignRouter.use(requireAuth);

esignRouter.get('/requests', requireFeature('esign.send'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
    res.json({ items: await esignService.list(firmId!, caseId) });
  } catch (err) { next(err); }
});

esignRouter.get(
  '/requests/:id',
  requireFeature('esign.send'),
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const item = await esignService.get((req.params as { id: string }).id, firmId!);
      if (!item) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(item);
    } catch (err) { next(err); }
  },
);

esignRouter.get(
  '/requests/:id/audit-trail',
  requireFeature('esign.send'),
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const events = await esignService.auditTrail((req.params as { id: string }).id, firmId!);
      res.json({ items: events });
    } catch (err) { next(err); }
  },
);

esignRouter.post(
  '/requests',
  requireFeature('esign.send'),
  validate({ body: CreateBody }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const body = req.body as z.infer<typeof CreateBody>;
      const created = await esignService.create({
        firmId: firmId!,
        requestedBy: req.user!.id,
        title: body.title,
        sourceDocumentId: body.sourceDocumentId,
        caseId: body.caseId ?? null,
        documentTypeHint: body.documentTypeHint ?? null,
        expiresInDays: body.expiresInDays,
        signers: body.signers,
      });
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

esignRouter.post(
  '/requests/:id/send',
  requireFeature('esign.send'),
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const sent = await esignService.send((req.params as { id: string }).id, firmId!);
      res.json(sent);
    } catch (err) { next(err); }
  },
);

esignRouter.post(
  '/requests/:id/cancel',
  requireFeature('esign.send'),
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      await esignService.cancel((req.params as { id: string }).id, firmId!);
      res.status(204).end();
    } catch (err) { next(err); }
  },
);
