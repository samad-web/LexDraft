import { Router } from 'express';
import { z } from 'zod';
import { clausesService } from '../services/clauses.service';

const CreateClause = z.object({
  category: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  body: z.string().default(''),
});

const UpdateClause = CreateClause.partial();

const Import = z.object({
  items: z.array(CreateClause).min(1).max(2000),
});

export const clausesRouter: Router = Router();

clausesRouter.get('/', async (req, res, next) => {
  try {
    const items = await clausesService.list({
      category: typeof req.query.category === 'string' ? req.query.category : undefined,
      q:        typeof req.query.q        === 'string' ? req.query.q        : undefined,
    });
    res.json({ items });
  } catch (err) { next(err); }
});

clausesRouter.post('/', async (req, res, next) => {
  try {
    const body = CreateClause.parse(req.body);
    res.status(201).json(await clausesService.create(body));
  } catch (err) { next(err); }
});

clausesRouter.patch('/:id', async (req, res, next) => {
  try {
    const body = UpdateClause.parse(req.body);
    const updated = await clausesService.update(req.params.id!, body);
    if (!updated) { res.status(404).json({ error: 'Clause not found' }); return; }
    res.json(updated);
  } catch (err) { next(err); }
});

clausesRouter.delete('/:id', async (req, res, next) => {
  try {
    const removed = await clausesService.remove(req.params.id!);
    if (!removed) { res.status(404).json({ error: 'Clause not found' }); return; }
    res.status(204).end();
  } catch (err) { next(err); }
});

clausesRouter.post('/:id/use', async (req, res, next) => {
  try {
    await clausesService.incrementUses(req.params.id!);
    res.status(204).end();
  } catch (err) { next(err); }
});

clausesRouter.post('/import', async (req, res, next) => {
  try {
    const body = Import.parse(req.body);
    res.json(await clausesService.importMany(body.items));
  } catch (err) { next(err); }
});
