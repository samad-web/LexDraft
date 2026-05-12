import { Router } from 'express';
import { z } from 'zod';
import { tasksService } from '../services/tasks.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';

const TaskInput = z.object({
  title: z.string(),
  case: z.string(),
  due: z.string(),
  priority: z.enum(['very_high', 'high', 'medium', 'low']),
  assignee: z.string(),
  comments: z.number().int().nonnegative().default(0),
  column: z.enum(['pending', 'progress', 'review', 'done']),
});

const Move = z.object({ to: z.enum(['pending', 'progress', 'review', 'done']) });

export const tasksRouter: Router = Router();

// Tasks live under the matter feature domain.
tasksRouter.get('/', requireFeature('matter.view'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json(await tasksService.board(firmId));
  } catch (err) {
    next(err);
  }
});

tasksRouter.post('/', requireFeature('matter.create'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.status(201).json(await tasksService.create(TaskInput.parse(req.body), firmId));
  } catch (err) {
    next(err);
  }
});

tasksRouter.patch('/:id', requireFeature('matter.create'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const updated = await tasksService.update(
      String(req.params.id ?? ''),
      TaskInput.partial().parse(req.body),
      firmId,
    );
    if (!updated) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

tasksRouter.post('/:id/move', requireFeature('matter.create'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const { to } = Move.parse(req.body);
    res.json(await tasksService.move(String(req.params.id ?? ''), to, firmId));
  } catch (err) {
    next(err);
  }
});

tasksRouter.delete('/:id', requireFeature('matter.create'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const removed = await tasksService.remove(String(req.params.id ?? ''), firmId);
    if (!removed) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
