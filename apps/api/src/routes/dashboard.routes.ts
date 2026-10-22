import { Router } from 'express';
import { dashboardService } from '../services/dashboard.service';
import { dashboardTodayService } from '../services/dashboard-today.service';

export const dashboardRouter: Router = Router();

// The advocate's-day dashboard (hearings, attention list, practice figures).
dashboardRouter.get('/today', async (req, res, next) => {
  try {
    res.json(await dashboardTodayService.today(req.user?.id));
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get('/', async (req, res, next) => {
  try {
    res.json(await dashboardService.summary(req.user?.id));
  } catch (err) {
    next(err);
  }
});
