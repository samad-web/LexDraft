import { Router } from 'express';
import { z } from 'zod';
import { limitationsService } from '../services/limitations.service';

const Input = z.object({
  caseLabel: z.string().min(1),
  cnr: z.string().default(''),
  filingType: z.string().min(1),
  forum: z.string().default(''),
  deadline: z.string(),
  filedBy: z.string().default(''),
});

export const limitationsRouter: Router = Router();

limitationsRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ items: await limitationsService.list() });
  } catch (err) {
    next(err);
  }
});

limitationsRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await limitationsService.create(Input.parse(req.body)));
  } catch (err) {
    next(err);
  }
});
