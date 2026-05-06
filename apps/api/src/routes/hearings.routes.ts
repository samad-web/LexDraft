import { Router } from 'express';
import { z } from 'zod';
import { hearingsService } from '../services/hearings.service';

const Input = z.object({
  case: z.string().min(1),
  time: z.string().min(1),
  court: z.string().min(1),
  purpose: z.string().min(1),
  status: z.enum(['today', 'upcoming', 'past']).default('upcoming'),
  date: z.string().optional(),
  judge: z.string().optional(),
});

export const hearingsRouter: Router = Router();

hearingsRouter.get('/today', async (_req, res, next) => {
  try {
    res.json({ items: await hearingsService.listToday() });
  } catch (err) {
    next(err);
  }
});

hearingsRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await hearingsService.create(Input.parse(req.body)));
  } catch (err) {
    next(err);
  }
});

hearingsRouter.get('/week', async (req, res, next) => {
  try {
    const start = typeof req.query.start === 'string' ? req.query.start : undefined;
    res.json(await hearingsService.week(start));
  } catch (err) {
    next(err);
  }
});

hearingsRouter.get('/day/:iso', async (req, res, next) => {
  try {
    res.json({ items: await hearingsService.listForDay(req.params.iso!) });
  } catch (err) {
    next(err);
  }
});

hearingsRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ items: await hearingsService.listUpcoming() });
  } catch (err) {
    next(err);
  }
});
