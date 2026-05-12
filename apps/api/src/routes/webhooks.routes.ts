import { Router } from 'express';
import { verifyWebhook } from '../services/webhooks.verify';

export const webhooksRouter: Router = Router();

// Inbound webhook router. Every `:source` must have a corresponding
// WEBHOOK_SECRET_<UPPERCASE> in env; the body is verified against the
// `x-signature: sha256=<hex>` header before any downstream processing.
// Sources without a configured secret are rejected (503) unless the
// operator has set `WEBHOOK_ALLOW_UNVERIFIED=true` in a non-prod env.
webhooksRouter.post('/:source', (req, res) => {
  const source = req.params.source ?? '';

  const verified = verifyWebhook(req, source);
  if (!verified.ok) {
    req.log.warn(
      { source, status: verified.status, reason: verified.reason },
      'webhook rejected',
    );
    res.status(verified.status).json({ error: verified.reason });
    return;
  }

  // Body is logged at debug only — production should not dump full
  // payloads (pino redaction covers obvious fields but provider shapes
  // vary). The reqId is in req.log so this entry correlates with the
  // morgan access line and any downstream handler logs.
  req.log.info({ source, bytes: req.rawBody?.length ?? 0 }, 'webhook received');

  // TODO: dispatch to per-provider handlers (eCourts hearings, payment
  // confirmations, e-sign callbacks). 2xx response acknowledges receipt
  // so the provider doesn't retry; actual work should be enqueued.
  res.status(202).json({ received: true });
});
