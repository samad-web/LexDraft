import { Router } from 'express';
import { firmService } from '../services/firm.service';

export const firmRouter: Router = Router();

firmRouter.get('/dashboard', async (req, res, next) => {
  try {
    res.json(await firmService.dashboard(req.user?.id));
  } catch (err) {
    next(err);
  }
});
