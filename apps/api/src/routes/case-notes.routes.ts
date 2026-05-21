import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { caseNotesService } from '../services/case-notes.service';
import { firmIdForUser } from '../services/tenant';
import { storage } from '../services/storage.service';
import { validate, uuidParam } from '../middleware/validate';
import { withAudit } from '../middleware/audit';
import { requireFeature } from '../services/permissions.service';
import { SUPPORTED_NOTE_MIME_TYPES } from '../lib/text-extraction';

// =============================================================================
// /api/case-notes - matter-scoped advocate notes (typed or uploaded).
//
// Mirrors the flat-router pattern used by hearings.routes (caseId travels via
// body / query rather than a nested URL). Reads gate on matter.notes.view;
// writes gate on matter.notes.create. Per-note edit/delete is additionally
// author-restricted at the service layer.
// =============================================================================

const Visibility = z.enum(['shared', 'private']);

const ListQuery = z.object({
  caseId: z.string().uuid(),
});

const CreateTypedInput = z.object({
  caseId:     z.string().uuid(),
  title:      z.string().trim().max(200).optional(),
  body:       z.string().trim().min(1).max(50_000),
  visibility: Visibility.optional(),
});

const UploadUrlInput = z.object({
  caseId:   z.string().uuid(),
  fileName: z.string().min(1).max(255),
  fileMime: z.enum(SUPPORTED_NOTE_MIME_TYPES),
  fileSize: z.number().int().min(1).max(25 * 1024 * 1024),
});

const FinalizeInput = z.object({
  caseId:     z.string().uuid(),
  title:      z.string().trim().max(200).optional(),
  visibility: Visibility.optional(),
  storageKey: z.string().min(1).max(512),
  fileName:   z.string().min(1).max(255),
  fileMime:   z.enum(SUPPORTED_NOTE_MIME_TYPES),
  fileSize:   z.number().int().min(1).max(25 * 1024 * 1024),
});

const UpdateInput = z.object({
  title:      z.string().trim().max(200).optional(),
  body:       z.string().trim().min(1).max(50_000).optional(),
  visibility: Visibility.optional(),
});

export const caseNotesRouter: Router = Router();

caseNotesRouter.get(
  '/',
  requireFeature('matter.notes.view'),
  validate({ query: ListQuery }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id) {
        res.status(422).json({ error: 'No firm attached - cannot list notes' });
        return;
      }
      const caseId = req.query['caseId'] as string;
      const items = await caseNotesService.list(caseId, {
        firmId,
        viewerUserId: req.user.id,
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

caseNotesRouter.post(
  '/',
  requireFeature('matter.notes.create'),
  validate({ body: CreateTypedInput }),
  withAudit({ action: 'matter.notes.create', targetType: 'case_note' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id) {
        res.status(422).json({ error: 'No firm attached - cannot create notes' });
        return;
      }
      const note = await caseNotesService.createTyped(req.body, {
        firmId,
        viewerUserId: req.user.id,
      });
      if (!note) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      res.status(201).json(note);
    } catch (err) {
      next(err);
    }
  },
);

caseNotesRouter.post(
  '/upload-url',
  requireFeature('matter.notes.create'),
  validate({ body: UploadUrlInput }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) {
        res.status(422).json({ error: 'No firm attached - cannot upload notes' });
        return;
      }
      const safeName = req.body.fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 200) || 'file';
      const random = crypto.randomBytes(8).toString('hex');
      const key = `case-notes/${firmId}/${req.body.caseId}/${random}_${safeName}`;
      const presigned = await storage().presignUpload({
        key,
        contentType: req.body.fileMime,
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
  },
);

caseNotesRouter.post(
  '/finalize',
  requireFeature('matter.notes.create'),
  validate({ body: FinalizeInput }),
  withAudit({ action: 'matter.notes.create', targetType: 'case_note' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id) {
        res.status(422).json({ error: 'No firm attached - cannot finalize notes' });
        return;
      }
      const note = await caseNotesService.finalizeUpload(req.body, {
        firmId,
        viewerUserId: req.user.id,
      });
      if (!note) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      res.status(201).json(note);
    } catch (err) {
      next(err);
    }
  },
);

caseNotesRouter.get(
  '/:id',
  requireFeature('matter.notes.view'),
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      const note = await caseNotesService.get(req.params['id'] as string, {
        firmId,
        viewerUserId: req.user.id,
      });
      if (!note) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      res.json(note);
    } catch (err) {
      next(err);
    }
  },
);

caseNotesRouter.patch(
  '/:id',
  requireFeature('matter.notes.create'),
  validate({ params: uuidParam, body: UpdateInput }),
  withAudit({ action: 'matter.notes.update', targetType: 'case_note' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      const note = await caseNotesService.update(
        req.params['id'] as string,
        req.body,
        { firmId, viewerUserId: req.user.id },
      );
      if (!note) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      res.json(note);
    } catch (err) {
      next(err);
    }
  },
);

caseNotesRouter.delete(
  '/:id',
  requireFeature('matter.notes.create'),
  validate({ params: uuidParam }),
  withAudit({ action: 'matter.notes.delete', targetType: 'case_note' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      const ok = await caseNotesService.delete(req.params['id'] as string, {
        firmId,
        viewerUserId: req.user.id,
      });
      if (!ok) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
