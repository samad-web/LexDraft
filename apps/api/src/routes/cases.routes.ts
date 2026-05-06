import { Router } from 'express';
import { z } from 'zod';
import { casesService } from '../services/cases.service';

const CaseInput = z.object({
  cnr: z.string(),
  title: z.string(),
  court: z.string(),
  stage: z.string(),
  client: z.string(),
  status: z.enum(['Active', 'Pending', 'Closed', 'Archived']),
  next: z.string(),
  type: z.string(),
});

export const casesRouter: Router = Router();

casesRouter.get('/', async (req, res, next) => {
  try {
    const items = await casesService.list({
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

casesRouter.get('/:id', async (req, res, next) => {
  try {
    const c = await casesService.get(req.params.id!);
    if (!c) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    res.json(c);
  } catch (err) {
    next(err);
  }
});

casesRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await casesService.create(CaseInput.parse(req.body)));
  } catch (err) {
    next(err);
  }
});

casesRouter.patch('/:id', async (req, res, next) => {
  try {
    const updated = await casesService.update(req.params.id!, CaseInput.partial().parse(req.body));
    if (!updated) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

casesRouter.delete('/:id', async (req, res, next) => {
  try {
    const removed = await casesService.remove(req.params.id!);
    if (!removed) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
