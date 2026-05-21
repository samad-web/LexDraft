import { Router } from 'express';
import { z } from 'zod';
import { clientsService } from '../services/clients.service';
import { firmIdForUser } from '../services/tenant';
import { validate, uuidParam } from '../middleware/validate';
import { withAudit } from '../middleware/audit';
import { requireFeature } from '../services/permissions.service';

const Input = z.object({
  name: z.string().min(1),
  type: z.enum(['Individual', 'Corporate', 'Govt']),
  status: z.enum(['active', 'inactive', 'prospect']),
  lastContact: z.string().optional().default(''),
  email: z.string().email().optional(),
});

// Update accepts any subset of the create fields. Empty strings on optional
// fields are normalised to undefined so the service uses coalesce() and the
// existing value sticks.
const UpdateInput = z.object({
  name:        z.string().min(1).optional(),
  type:        z.enum(['Individual', 'Corporate', 'Govt']).optional(),
  status:      z.enum(['active', 'inactive', 'prospect']).optional(),
  lastContact: z.string().optional(),
  email:       z.union([z.string().email(), z.literal('')]).optional(),
}).strict();

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

clientsRouter.patch(
  '/:id',
  // `client.create` is the canonical "edit clients" feature flag in the spec
  // — there's no separate `client.update` key, mirroring how cases work.
  requireFeature('client.create'),
  validate({ params: uuidParam, body: UpdateInput }),
  withAudit({ action: 'client.update', targetType: 'client' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof UpdateInput>;
      // Normalise '' → undefined for email so it doesn't blank out an
      // existing valid address (coalesce treats null as "keep current",
      // but empty string would overwrite). Frontend should send undefined
      // to skip a field, but defence-in-depth.
      const patch = {
        ...body,
        email: body.email === '' ? undefined : body.email,
      };
      const updated = await clientsService.update(id, patch, firmId);
      if (!updated) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

clientsRouter.delete(
  '/:id',
  requireFeature('client.create'),
  validate({ params: uuidParam }),
  withAudit({ action: 'client.delete', targetType: 'client' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const { id } = req.params as { id: string };
      const ok = await clientsService.remove(id, firmId);
      if (!ok) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
