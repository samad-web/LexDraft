import { Router } from 'express';
import { dashboardService } from '../services/dashboard.service';

export const dashboardRouter: Router = Router();

dashboardRouter.get('/', async (req, res, next) => {
  try {
    res.json(await dashboardService.summary(req.user?.id));
  } catch (err) {
    next(err);
  }
});
