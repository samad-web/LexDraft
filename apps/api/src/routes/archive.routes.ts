import { Router } from 'express';
import { archiveService } from '../services/archive.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';

export const archiveRouter: Router = Router();

// Archive is the read-only view of closed matters - gates on matter.view.
archiveRouter.get('/', requireFeature('matter.view'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json({ items: await archiveService.list(firmId) });
  } catch (err) {
    next(err);
  }
});
