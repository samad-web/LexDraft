import { Router } from 'express';
import { z } from 'zod';
import { clientsService } from '../services/clients.service';

const Input = z.object({
  name: z.string().min(1),
  type: z.enum(['Individual', 'Corporate', 'Govt']),
  status: z.enum(['active', 'inactive', 'prospect']),
  lastContact: z.string().optional().default(''),
});

export const clientsRouter: Router = Router();

clientsRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ items: await clientsService.list() });
  } catch (err) {
    next(err);
  }
});

clientsRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await clientsService.create(Input.parse(req.body)));
  } catch (err) {
    next(err);
  }
});
