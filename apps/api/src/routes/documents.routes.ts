import { Router } from 'express';
import { z } from 'zod';
import { documentsService } from '../services/documents.service';

const DocInput = z.object({
  name: z.string(),
  type: z.string(),
  updated: z.string(),
  case: z.string(),
});

export const documentsRouter: Router = Router();

documentsRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ items: await documentsService.list() });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get('/:id', async (req, res, next) => {
  try {
    const d = await documentsService.get(req.params.id!);
    if (!d) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json(d);
  } catch (err) {
    next(err);
  }
});

documentsRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await documentsService.create(DocInput.parse(req.body)));
  } catch (err) {
    next(err);
  }
});
