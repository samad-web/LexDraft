import { Router } from 'express';
import { z } from 'zod';
import { physicalDocumentsService } from '../services/physical-documents.service';
import { firmIdForUser } from '../services/tenant';
import { validate, idParam } from '../middleware/validate';
import { requireFeature } from '../services/permissions.service';

const Status = z.enum([
  'in_chambers', 'court_file', 'client', 'co_counsel',
  'archive_box', 'lost', 'returned',
]);

const CreateInput = z.object({
  caseId: z.string().uuid().nullable().optional(),
  caseLabel: z.string().max(200).optional(),
  fileNo: z.string().min(1).max(80),
  title: z.string().min(1).max(240),
  docType: z.string().max(80).optional(),
  location: z.string().min(1).max(200),
  custodian: z.string().max(120).optional(),
  status: Status.optional(),
  notes: z.string().max(2000).optional(),
  receivedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const UpdateInput = CreateInput.partial();

const ListQuery = z.object({
  status: Status.optional(),
  q: z.string().optional(),
});

export const physicalDocumentsRouter: Router = Router();

physicalDocumentsRouter.get(
  '/',
  requireFeature('matter.view'),
  validate({ query: ListQuery }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const status = typeof req.query['status'] === 'string'
        ? (req.query['status'] as ReturnType<typeof Status.parse>) : undefined;
      const q = typeof req.query['q'] === 'string' ? (req.query['q'] as string) : undefined;
      const items = await physicalDocumentsService.list({ firmId, ...(status ? { status } : {}), ...(q ? { q } : {}) });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

physicalDocumentsRouter.get(
  '/:id',
  requireFeature('matter.view'),
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const id = typeof req.params['id'] === 'string' ? (req.params['id'] as string) : '';
      const item = await physicalDocumentsService.get(id, firmId);
      if (!item) { res.status(404).json({ error: 'Document not found' }); return; }
      res.json(item);
    } catch (err) {
      next(err);
    }
  },
);

physicalDocumentsRouter.post(
  '/',
  requireFeature('matter.create'),
  validate({ body: CreateInput }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      res.status(201).json(await physicalDocumentsService.create(req.body, firmId));
    } catch (err) {
      next(err);
    }
  },
);

physicalDocumentsRouter.patch(
  '/:id',
  requireFeature('matter.create'),
  validate({ params: idParam, body: UpdateInput }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const id = typeof req.params['id'] === 'string' ? (req.params['id'] as string) : '';
      const updated = await physicalDocumentsService.update(id, req.body, firmId);
      if (!updated) { res.status(404).json({ error: 'Document not found' }); return; }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

physicalDocumentsRouter.delete(
  '/:id',
  requireFeature('matter.create'),
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const id = typeof req.params['id'] === 'string' ? (req.params['id'] as string) : '';
      const removed = await physicalDocumentsService.remove(id, firmId);
      if (!removed) { res.status(404).json({ error: 'Document not found' }); return; }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
