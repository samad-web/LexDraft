import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import type { DocumentRecord } from '@lexdraft/types';
import { documentsService } from '../services/documents.service';
import { draftsService } from '../services/drafts.service';
import { firmIdForUser } from '../services/tenant';
import { storage } from '../services/storage.service';
import { validate, idParam } from '../middleware/validate';
import { withAudit } from '../middleware/audit';
import { requireFeature } from '../services/permissions.service';

const DocInput = z.object({
  name: z.string(),
  type: z.string(),
  updated: z.string(),
  case: z.string(),
  // Legacy base64 path (still supported for small files; new clients should
  // use the presigned-URL flow below).
  fileName: z.string().max(255).optional(),
  fileMime: z.string().max(255).optional(),
  fileSize: z.number().int().min(0).max(12 * 1024 * 1024).optional(),
  fileBase64: z.string().optional(),
});

const DocPatchInput = z.object({
  name: z.string().min(1).max(255).optional(),
  type: z.string().min(1).max(120).optional(),
  case: z.string().min(1).max(255).optional(),
}).refine((p) => p.name !== undefined || p.type !== undefined || p.case !== undefined, {
  message: 'At least one of name, type, case must be supplied',
});

const UploadUrlInput = z.object({
  fileName: z.string().min(1).max(255),
  fileMime: z.string().min(1).max(255),
  fileSize: z.number().int().min(1).max(25 * 1024 * 1024),
});

const FinalizeUploadInput = z.object({
  storageKey: z.string().min(1).max(512),
  fileName: z.string().min(1).max(255),
  fileMime: z.string().min(1).max(255),
  fileSize: z.number().int().min(1).max(25 * 1024 * 1024),
});

function relativeFromIso(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '-';
  const diff = Date.now() - then;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.round(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  return `${Math.round(mon / 12)}y ago`;
}

export const documentsRouter: Router = Router();

// Documents read uses the baseline `shared.documents` so every authenticated
// firm member can see what's been shared with them. Writes/uploads gate on
// drafting.basic - same key as drafts editing.

documentsRouter.get('/', requireFeature('shared.documents'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const firmId = await firmIdForUser(userId);
    const [docs, drafts] = await Promise.all([
      documentsService.list(firmId),
      userId ? draftsService.list({ userId }) : Promise.resolve([]),
    ]);
    const draftDocs: DocumentRecord[] = drafts.map((d) => ({
      id: d.id,
      name: d.title,
      type: d.docType,
      case: '-',
      updated: relativeFromIso(d.updatedAt),
      kind: 'draft',
    }));
    res.json({ items: [...draftDocs, ...docs] });
  } catch (err) {
    next(err);
  }
});

function strParam(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

documentsRouter.get('/:id', requireFeature('shared.documents'), validate({ params: idParam }), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const d = await documentsService.get(strParam(req.params['id']), firmId);
    if (!d) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json(d);
  } catch (err) {
    next(err);
  }
});

documentsRouter.post(
  '/',
  requireFeature('drafting.basic'),
  validate({ body: DocInput }),
  withAudit({ action: 'document.create', targetType: 'document' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      res.status(201).json(await documentsService.create(req.body, firmId));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Presigned-URL upload flow.
//   1. POST /documents/upload-url  →  { uploadUrl, storageKey, expiresAt, requiredContentType }
//   2. Client PUTs the binary directly to uploadUrl
//   3. POST /documents/:id/finalize  with { storageKey, fileName, fileMime, fileSize }
//      (or POST /documents/  with storageKey to create a new doc that owns the upload)
// ---------------------------------------------------------------------------

documentsRouter.post('/upload-url', requireFeature('drafting.basic'), validate({ body: UploadUrlInput }), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    if (!firmId) {
      res.status(422).json({ error: 'No firm attached - cannot upload documents' });
      return;
    }
    const safeName = req.body.fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 200) || 'file';
    const random = crypto.randomBytes(8).toString('hex');
    const key = `documents/${firmId}/${random}_${safeName}`;
    const presigned = await storage().presignUpload({ key, contentType: req.body.fileMime });
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

documentsRouter.post(
  '/:id/finalize',
  requireFeature('drafting.basic'),
  validate({ params: idParam, body: FinalizeUploadInput }),
  withAudit({ action: 'document.update', targetType: 'document' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const updated = await documentsService.attachStorage(strParam(req.params['id']), firmId, req.body);
      if (!updated) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

documentsRouter.patch(
  '/:id',
  requireFeature('drafting.basic'),
  validate({ params: idParam, body: DocPatchInput }),
  withAudit({ action: 'document.update', targetType: 'document' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const updated = await documentsService.update(strParam(req.params['id']), firmId, req.body);
      if (!updated) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

documentsRouter.delete(
  '/:id',
  requireFeature('drafting.basic'),
  validate({ params: idParam }),
  withAudit({ action: 'document.delete', targetType: 'document' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const ok = await documentsService.remove(strParam(req.params['id']), firmId);
      if (!ok) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

documentsRouter.get('/:id/download-url', requireFeature('shared.documents'), validate({ params: idParam }), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const file = await documentsService.getStorageKey(strParam(req.params['id']), firmId);
    if (!file) {
      res.status(404).json({ error: 'No file attached to this document' });
      return;
    }
    const presigned = await storage().presignDownload({ key: file.key });
    res.json(presigned);
  } catch (err) {
    next(err);
  }
});
