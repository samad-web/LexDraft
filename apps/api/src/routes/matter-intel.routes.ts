import { Router } from 'express';
import { z } from 'zod';
import { matterIntelService } from '../services/matter-intel.service';
import { firmIdForUser, caseBelongsToFirm } from '../services/tenant';
import { storage } from '../services/storage.service';
import { validate, uuidParam } from '../middleware/validate';
import { requireFeature } from '../services/permissions.service';
import { logger } from '../logger';
import { SUPPORTED_NOTE_MIME_TYPES } from '../lib/text-extraction';

// =============================================================================
// /api/matter-intel — document ingestion + structured summary + matter brief.
//
// Upload flow (mirrors case-notes.routes):
//   1. POST /:caseId/upload-url  → server returns a presigned PUT URL +
//                                   storageKey. The client uploads the file
//                                   bytes directly to that URL.
//   2. POST /:caseId/upload      → server pulls the bytes back via storage(),
//                                   hashes them, persists matter_documents,
//                                   and kicks off extract → chunk → embed.
//
// Existing-document ingest:
//   POST /:caseId/pull/:documentId — registers an existing documents-table
//   row as a matter intel source. No file motion; the blob is shared.
//
// Brief:
//   GET  /:caseId/brief                — fetch the current (un-superseded) brief.
//   POST /:caseId/brief/regenerate     — synthesise a new brief over all
//                                         per-document summaries.
// =============================================================================

const ACCEPTED_MIMES = SUPPORTED_NOTE_MIME_TYPES;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const CaseParam = z.object({ caseId: z.string().uuid() });
const CaseAndDocParam = z.object({
  caseId:     z.string().uuid(),
  documentId: z.string().uuid(),
});

const UploadUrlInput = z.object({
  fileName: z.string().min(1).max(255),
  fileMime: z.enum(ACCEPTED_MIMES),
  fileSize: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
});

const FinalizeUploadInput = z.object({
  storageKey: z.string().min(1).max(512),
  fileName:   z.string().min(1).max(255),
  fileMime:   z.enum(ACCEPTED_MIMES),
  fileSize:   z.number().int().min(1).max(MAX_UPLOAD_BYTES),
});

export const matterIntelRouter: Router = Router();

// ---------------------------------------------------------------------------
// List + read
// ---------------------------------------------------------------------------

matterIntelRouter.get(
  '/:caseId/documents',
  requireFeature('matter.intelligence'),
  validate({ params: CaseParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) {
        res.status(422).json({ error: 'No firm attached - cannot list matter documents' });
        return;
      }
      const items = await matterIntelService.listMatterDocuments({
        firmId,
        caseId: (req.params as { caseId: string }).caseId,
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

matterIntelRouter.get(
  '/documents/:id',
  requireFeature('matter.intelligence'),
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      const doc = await matterIntelService.getMatterDocument({
        firmId,
        id: (req.params as { id: string }).id,
      });
      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      res.json(doc);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Upload (presigned URL + finalize)
// ---------------------------------------------------------------------------

matterIntelRouter.post(
  '/:caseId/upload-url',
  requireFeature('matter.intelligence'),
  validate({ params: CaseParam, body: UploadUrlInput }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) {
        res.status(422).json({ error: 'No firm attached' });
        return;
      }
      const { caseId } = req.params as { caseId: string };
      // Verify the case belongs to this firm BEFORE signing a URL — otherwise
      // a caller could burn presigned URLs against arbitrary caseIds (storage
      // path enumeration / quota abuse). The downstream `finalize` step does
      // verify ownership, but signing-then-rejecting wastes round-trips.
      if (!(await caseBelongsToFirm(firmId, caseId))) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      const safeName = req.body.fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 200) || 'file';
      // Random prefix keeps a pre-finalize key collision-free even when two
      // users upload the same file name at the same time. The matter-intel
      // service later replaces this with a content-hash-based key when it
      // takes ownership of the persistent blob.
      const random = Math.random().toString(36).slice(2, 14);
      const key = `matter-intel/_inbox/${firmId}/${caseId}/${random}_${safeName}`;
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

matterIntelRouter.post(
  '/:caseId/upload',
  requireFeature('matter.intelligence'),
  validate({ params: CaseParam, body: FinalizeUploadInput }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id || !req.user?.email) {
        res.status(422).json({ error: 'No firm attached - cannot finalize upload' });
        return;
      }
      // Pull the bytes back from storage so the service can hash, persist
      // under a canonical key, and run extraction. Presigned uploads land in
      // an _inbox/ prefix; on success we hand ownership over to the service
      // and the _inbox blob is deleted (best-effort cleanup below).
      const obj = await storage().getObject(req.body.storageKey);
      if (!obj) {
        res.status(404).json({ error: 'Uploaded blob not found at storageKey' });
        return;
      }
      if (obj.body.length !== req.body.fileSize) {
        // Defence-in-depth: the client-declared size must match the bytes
        // we actually pulled, otherwise an attacker could trick us into
        // over-budget ingestion by lying about size.
        res.status(400).json({ error: 'Uploaded blob size does not match declared size' });
        return;
      }
      const doc = await matterIntelService.ingestUpload({
        firmId,
        caseId: (req.params as { caseId: string }).caseId,
        userId: req.user.id,
        userEmail: req.user.email,
        file: {
          buffer: obj.body,
          fileName: req.body.fileName,
          mimeType: req.body.fileMime,
        },
      });
      // Best-effort cleanup of the _inbox blob now that the service has
      // copied the bytes under a canonical hash-based key.
      void storage().delete(req.body.storageKey).catch((err) =>
        logger.warn({ err, key: req.body.storageKey }, 'matter-intel inbox cleanup failed'));
      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Pull existing matter document into matter intelligence
// ---------------------------------------------------------------------------

matterIntelRouter.post(
  '/:caseId/pull/:documentId',
  requireFeature('matter.intelligence'),
  validate({ params: CaseAndDocParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id || !req.user?.email) {
        res.status(422).json({ error: 'No firm attached' });
        return;
      }
      const { caseId, documentId } = req.params as { caseId: string; documentId: string };
      const doc = await matterIntelService.ingestExistingMatterDocument({
        firmId,
        caseId,
        documentId,
        userId: req.user.id,
        userEmail: req.user.email,
      });
      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Summarise (regenerate)
// ---------------------------------------------------------------------------

matterIntelRouter.post(
  '/documents/:id/summarise',
  requireFeature('matter.intelligence'),
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id || !req.user?.email) {
        res.status(422).json({ error: 'No firm attached' });
        return;
      }
      const summary = await matterIntelService.summariseDocument({
        firmId,
        matterDocumentId: (req.params as { id: string }).id,
        userId: req.user.id,
        userEmail: req.user.email,
      });
      res.json(summary);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------

matterIntelRouter.get(
  '/:caseId/brief',
  requireFeature('matter.intelligence'),
  validate({ params: CaseParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) {
        res.status(422).json({ error: 'No firm attached' });
        return;
      }
      const brief = await matterIntelService.getCurrentBrief({
        firmId,
        caseId: (req.params as { caseId: string }).caseId,
      });
      if (!brief) {
        res.status(404).json({ error: 'No brief yet for this matter' });
        return;
      }
      res.json(brief);
    } catch (err) {
      next(err);
    }
  },
);

matterIntelRouter.post(
  '/:caseId/brief/regenerate',
  requireFeature('matter.intelligence'),
  validate({ params: CaseParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id || !req.user?.email) {
        res.status(422).json({ error: 'No firm attached' });
        return;
      }
      const brief = await matterIntelService.generateMatterBrief({
        firmId,
        caseId: (req.params as { caseId: string }).caseId,
        userId: req.user.id,
        userEmail: req.user.email,
      });
      res.json(brief);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Delete a matter-intel document
// ---------------------------------------------------------------------------

matterIntelRouter.delete(
  '/documents/:id',
  requireFeature('matter.intelligence'),
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id || !req.user?.email) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      await matterIntelService.removeMatterDocument({
        firmId,
        id: (req.params as { id: string }).id,
        userId: req.user.id,
        userEmail: req.user.email,
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Quick studies — sandbox matters for ad-hoc "just upload a file" flows.
// They live in the same `cases` table (kind='sandbox', created_by_user_id
// scoped) so the existing matter-intel pipeline works unchanged. The
// casesService list filter hides them from Cases / Clients / Leads / etc.
// ---------------------------------------------------------------------------

const QuickStudyInput = z.object({
  title: z.string().min(1).max(200).optional(),
});

matterIntelRouter.get(
  '/quick-studies',
  requireFeature('matter.intelligence'),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id) {
        res.json({ items: [] });
        return;
      }
      const items = await matterIntelService.listQuickStudies({
        firmId,
        userId: req.user.id,
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

matterIntelRouter.post(
  '/quick-studies',
  requireFeature('matter.intelligence'),
  validate({ body: QuickStudyInput }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id) {
        res.status(422).json({ error: 'No firm attached' });
        return;
      }
      const sandbox = await matterIntelService.createQuickStudy({
        firmId,
        userId: req.user.id,
        title: req.body.title,
      });
      res.status(201).json(sandbox);
    } catch (err) {
      next(err);
    }
  },
);
