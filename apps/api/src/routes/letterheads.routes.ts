/**
 * Letterhead routes - backs the Settings → Letterhead designer.
 *
 *   GET    /api/letterheads                - firm + personal designs + effective default
 *   POST   /api/letterheads                - create (firm-scoped or personal)
 *   GET    /api/letterheads/:id            - single design
 *   PATCH  /api/letterheads/:id            - update fields / promote default
 *   DELETE /api/letterheads/:id            - remove
 *   POST   /api/letterheads/logo-upload-url - presigned PUT for a logo image
 *
 * Gate: `drafting.basic` - the same feature anyone who can export a document
 * already has. We deliberately don't gate on `admin.users` because every
 * advocate needs their letterhead for their own exports; firm-wide designs
 * are an extra layer the firm admin can curate, not a prerequisite.
 *
 * Logo upload mirrors the documents flow: client calls /logo-upload-url to
 * get a presigned PUT, PUTs the binary, then sends the returned `storageKey`
 * back as `logoKey` on the create / update payload.
 */

import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { letterheadsService } from '../services/letterheads.service';
import { storage } from '../services/storage.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { UnauthorizedError, UnprocessableEntityError } from '../lib/errors';

const TEMPLATE_KEYS = [
  'classic-centered',
  'logo-left',
  'minimalist',
  'two-column',
  'court-filing',
  'modern-accent',
] as const;

const Fields = z.object({
  firmName: z.string().max(200).optional(),
  tagline: z.string().max(200).optional(),
  addressLines: z.array(z.string().max(200)).max(8).optional(),
  phone: z.string().max(64).optional(),
  email: z.string().max(120).optional(),
  website: z.string().max(200).optional(),
  regNumber: z.string().max(200).optional(),
  footerText: z.string().max(500).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
});

const Create = z.object({
  scope: z.enum(['firm', 'personal']),
  name: z.string().min(1).max(120),
  templateKey: z.enum(TEMPLATE_KEYS),
  fields: Fields,
  logoKey: z.string().max(512).nullable().optional(),
  isDefault: z.boolean().optional(),
});

const Update = z.object({
  name: z.string().min(1).max(120).optional(),
  templateKey: z.enum(TEMPLATE_KEYS).optional(),
  fields: Fields.optional(),
  logoKey: z.string().max(512).nullable().optional(),
  isDefault: z.boolean().optional(),
});

const LogoUpload = z.object({
  fileName: z.string().min(1).max(255),
  fileMime: z.string().min(1).max(120),
  // 2MB cap - letterhead logos should be small. Anything larger is likely
  // unoptimised and would bloat every generated PDF.
  fileSize: z.number().int().min(1).max(2 * 1024 * 1024),
});

const ALLOWED_LOGO_MIMES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/svg+xml',
  'image/webp',
]);

const gate = requireFeature('drafting.basic');

export const letterheadsRouter: Router = Router();

letterheadsRouter.get('/', gate, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    if (!firmId) {
      res.json({ firmItems: [], personalItems: [], effectiveDefault: null });
      return;
    }
    res.json(await letterheadsService.list({ firmId, userId }));
  } catch (err) {
    next(err);
  }
});

letterheadsRouter.post('/', gate, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    if (!firmId) {
      throw new UnprocessableEntityError('No firm attached - cannot create letterhead');
    }
    const body = Create.parse(req.body);
    const created = await letterheadsService.create(body, { firmId, userId });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// Presigned logo upload - defined BEFORE /:id so Express doesn't match
// 'logo-upload-url' as an id.
letterheadsRouter.post('/logo-upload-url', gate, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    if (!firmId) {
      throw new UnprocessableEntityError('No firm attached - cannot upload logo');
    }
    const body = LogoUpload.parse(req.body);
    if (!ALLOWED_LOGO_MIMES.has(body.fileMime.toLowerCase())) {
      throw new UnprocessableEntityError(
        'Unsupported logo format. Use PNG, JPG, SVG, or WebP.',
      );
    }
    const safeName = body.fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 200) || 'logo';
    const random = crypto.randomBytes(8).toString('hex');
    const key = `letterheads/${firmId}/${random}_${safeName}`;
    const presigned = await storage().presignUpload({
      key,
      contentType: body.fileMime,
    });
    res.json({
      uploadUrl: presigned.uploadUrl,
      storageKey: presigned.key,
      expiresAt: presigned.expiresAt,
      requiredContentType: presigned.requiredContentType,
    });
  } catch (err) {
    next(err);
  }
});

letterheadsRouter.get('/:id', gate, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    if (!firmId) {
      throw new UnprocessableEntityError('No firm attached');
    }
    const found = await letterheadsService.get(String(req.params.id ?? ''), {
      firmId,
      userId,
    });
    res.json(found);
  } catch (err) {
    next(err);
  }
});

// Presigned GET URL for the letterhead's logo. Goes through the letterhead
// row first so tenant scope is enforced - passing a raw storage key from
// the client would bypass that.
letterheadsRouter.get('/:id/logo-url', gate, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    if (!firmId) {
      throw new UnprocessableEntityError('No firm attached');
    }
    const lh = await letterheadsService.get(String(req.params.id ?? ''), {
      firmId,
      userId,
    });
    if (!lh.logoKey) {
      res.json({ downloadUrl: null, expiresAt: null });
      return;
    }
    const presigned = await storage().presignDownload({ key: lh.logoKey });
    res.json(presigned);
  } catch (err) {
    next(err);
  }
});

letterheadsRouter.patch('/:id', gate, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    if (!firmId) {
      throw new UnprocessableEntityError('No firm attached');
    }
    const body = Update.parse(req.body);
    const updated = await letterheadsService.update(
      String(req.params.id ?? ''),
      body,
      { firmId, userId },
    );
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

letterheadsRouter.delete('/:id', gate, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    if (!firmId) {
      throw new UnprocessableEntityError('No firm attached');
    }
    await letterheadsService.remove(String(req.params.id ?? ''), { firmId, userId });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
