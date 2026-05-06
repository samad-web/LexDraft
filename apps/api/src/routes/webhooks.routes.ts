import { Router } from 'express';
import { logger } from '../logger';

export const webhooksRouter: Router = Router();

// Generic inbound webhook stub. Plug in real handlers (eCourts, payments, e-sign)
// and verify signatures per provider here.
webhooksRouter.post('/:source', (req, res) => {
  logger.info({ source: req.params.source, body: req.body }, 'webhook received');
  res.status(202).json({ received: true });
});
