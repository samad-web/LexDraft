import { Router } from 'express';
import { z } from 'zod';
import { remindersService } from '../services/reminders.service';
import { firmIdForUser } from '../services/tenant';
import { validate, uuidParam } from '../middleware/validate';
import { requireFeature } from '../services/permissions.service';

// Reminders an advocate sets by hand (build-docs/features/reminders.md).
// User-scoped: everyone sees and deletes only their own.

const CreateInput = z.object({
  caseId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(160),
  note: z.string().max(500).optional(),
  remindAt: z.string().min(10).max(40),
});

const ListQuery = z.object({ caseId: z.string().uuid().optional() });

export const remindersRouter: Router = Router();

remindersRouter.get('/', requireFeature('matter.view'), validate({ query: ListQuery }), async (req, res, next) => {
  try {
    res.json({ items: await remindersService.list(req.user!.id, (req.query as { caseId?: string }).caseId) });
  } catch (err) {
    next(err);
  }
});

remindersRouter.post('/', requireFeature('matter.view'), validate({ body: CreateInput }), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user!.id);
    if (!firmId) { res.status(422).json({ error: 'No firm attached' }); return; }
    res.status(201).json(await remindersService.create(req.user!.id, firmId, req.body));
  } catch (err) {
    next(err);
  }
});

remindersRouter.delete('/:id', requireFeature('matter.view'), validate({ params: uuidParam }), async (req, res, next) => {
  try {
    const ok = await remindersService.remove(req.user!.id, (req.params as { id: string }).id);
    if (!ok) { res.status(404).json({ error: 'Reminder not found' }); return; }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
