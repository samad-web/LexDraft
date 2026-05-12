import { Router } from 'express';
import { analyticsService } from '../services/analytics.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';

export const analyticsRouter: Router = Router();

analyticsRouter.get('/', requireFeature('reports.activity'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json(await analyticsService.summary(firmId));
  } catch (err) {
    next(err);
  }
});
