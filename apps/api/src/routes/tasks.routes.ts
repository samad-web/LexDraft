import { Router } from 'express';
import { z } from 'zod';
import { tasksService } from '../services/tasks.service';

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

tasksRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await tasksService.board());
  } catch (err) {
    next(err);
  }
});

tasksRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await tasksService.create(TaskInput.parse(req.body)));
  } catch (err) {
    next(err);
  }
});

tasksRouter.patch('/:id', async (req, res, next) => {
  try {
    const updated = await tasksService.update(req.params.id!, TaskInput.partial().parse(req.body));
    if (!updated) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

tasksRouter.post('/:id/move', async (req, res, next) => {
  try {
    const { to } = Move.parse(req.body);
    res.json(await tasksService.move(req.params.id!, to));
  } catch (err) {
    next(err);
  }
});

tasksRouter.delete('/:id', async (req, res, next) => {
  try {
    const removed = await tasksService.remove(req.params.id!);
    if (!removed) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
