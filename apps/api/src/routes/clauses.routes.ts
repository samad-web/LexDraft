import { Router } from 'express';
import { z } from 'zod';
import { clausesService } from '../services/clauses.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';

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

clausesRouter.get('/', requireFeature('drafting.clauses'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const items = await clausesService.list({
      firmId,
      category: typeof req.query.category === 'string' ? req.query.category : undefined,
      q:        typeof req.query.q        === 'string' ? req.query.q        : undefined,
    });
    res.json({ items });
  } catch (err) { next(err); }
});

clausesRouter.post('/', requireFeature('drafting.clauses'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const body = CreateClause.parse(req.body);
    res.status(201).json(await clausesService.create(body, firmId));
  } catch (err) { next(err); }
});

clausesRouter.patch('/:id', requireFeature('drafting.clauses'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const body = UpdateClause.parse(req.body);
    const updated = await clausesService.update(String(req.params.id ?? ''), body, firmId);
    if (!updated) { res.status(404).json({ error: 'Clause not found' }); return; }
    res.json(updated);
  } catch (err) { next(err); }
});

clausesRouter.delete('/:id', requireFeature('drafting.clauses'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const removed = await clausesService.remove(String(req.params.id ?? ''), firmId);
    if (!removed) { res.status(404).json({ error: 'Clause not found' }); return; }
    res.status(204).end();
  } catch (err) { next(err); }
});

clausesRouter.post('/:id/use', requireFeature('drafting.clauses'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    await clausesService.incrementUses(String(req.params.id ?? ''), firmId);
    res.status(204).end();
  } catch (err) { next(err); }
});

clausesRouter.post('/import', requireFeature('drafting.clauses'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const body = Import.parse(req.body);
    res.json(await clausesService.importMany(body.items, firmId));
  } catch (err) { next(err); }
});
