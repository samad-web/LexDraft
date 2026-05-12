import { Router } from 'express';
import { z } from 'zod';
import { clientsService } from '../services/clients.service';
import { firmIdForUser } from '../services/tenant';
import { validate } from '../middleware/validate';
import { withAudit } from '../middleware/audit';
import { requireFeature } from '../services/permissions.service';

const Input = z.object({
  name: z.string().min(1),
  type: z.enum(['Individual', 'Corporate', 'Govt']),
  status: z.enum(['active', 'inactive', 'prospect']),
  lastContact: z.string().optional().default(''),
  email: z.string().email().optional(),
});

export const clientsRouter: Router = Router();

clientsRouter.get('/', requireFeature('client.view'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json({ items: await clientsService.list(firmId) });
  } catch (err) {
    next(err);
  }
});

clientsRouter.post(
  '/',
  requireFeature('client.create'),
  validate({ body: Input }),
  withAudit({ action: 'client.create', targetType: 'client' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      res.status(201).json(await clientsService.create(req.body, firmId));
    } catch (err) {
      next(err);
    }
  },
);
