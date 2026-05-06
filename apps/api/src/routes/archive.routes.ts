import { Router } from 'express';
import { archiveService } from '../services/archive.service';

export const archiveRouter: Router = Router();

archiveRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ items: await archiveService.list() });
  } catch (err) {
    next(err);
  }
});
