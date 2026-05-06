import { Router } from 'express';
import { analyticsService } from '../services/analytics.service';

export const analyticsRouter: Router = Router();

analyticsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await analyticsService.summary());
  } catch (err) {
    next(err);
  }
});
