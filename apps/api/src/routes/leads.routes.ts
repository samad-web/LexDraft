import { Router } from 'express';
import { z } from 'zod';
import { leadsService } from '../services/leads.service';

const Stage = z.enum(['new', 'qualified', 'proposal', 'won', 'lost']);

const CreateInput = z.object({
  name: z.string().min(1),
  valueInr: z.number().int().nonnegative(),
  referrer: z.string().default(''),
  stage: Stage.default('new'),
});

const StageInput = z.object({ stage: Stage });

export const leadsRouter: Router = Router();

leadsRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ items: await leadsService.list() });
  } catch (err) {
    next(err);
  }
});

leadsRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await leadsService.create(CreateInput.parse(req.body)));
  } catch (err) {
    next(err);
  }
});

leadsRouter.patch('/:id/stage', async (req, res, next) => {
  try {
    const updated = await leadsService.updateStage(req.params.id!, StageInput.parse(req.body).stage);
    if (!updated) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

leadsRouter.delete('/:id', async (req, res, next) => {
  try {
    const removed = await leadsService.remove(req.params.id!);
    if (!removed) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
