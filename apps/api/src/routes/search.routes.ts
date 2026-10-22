import { Router } from 'express';
import { searchService } from '../services/search.service';

export const searchRouter: Router = Router();

// Ctrl+K quick search: GET /search?q=...
searchRouter.get('/', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(await searchService.search(req.user?.id, q));
  } catch (err) {
    next(err);
  }
});
