import { Router } from 'express';
import { verifyWebhook } from '../services/webhooks.verify';

export const webhooksRouter: Router = Router();

// =============================================================================
// Inbound webhook router — VERIFY-ONLY surface today
// =============================================================================
// Every `:source` must have a corresponding WEBHOOK_SECRET_<UPPERCASE> in env;
// the body is verified against the `x-signature: sha256=<hex>` header before
// any downstream processing. Sources without a configured secret are rejected
// (503) unless the operator has set `WEBHOOK_ALLOW_UNVERIFIED=true` in a
// non-prod env.
//
// IMPORTANT — what this route currently does NOT do:
//
//   This endpoint acknowledges verified webhooks (202 Received) and stops
//   there. No provider handlers (eCourts CNR sync, payment confirmations,
//   e-sign callbacks) are wired. Operators integrating with providers must
//   either:
//     (a) extend this file with per-source dispatch + jobs.enqueue(...) calls,
//         or
//     (b) configure providers to POST to provider-specific endpoints elsewhere
//         in the API tree.
//
//   Treat the docs in OVERVIEW.md §2.3 / §4.8 and APPLICATION_ARCHITECTURE.md
//   §2 / §11 that imply live provider sync as ASPIRATIONAL until a follow-up
//   PR lands a dispatch layer.
// =============================================================================
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

  // Body is logged at debug only — production should not dump full payloads
  // (pino redaction covers obvious fields but provider shapes vary). The
  // reqId is in req.log so this entry correlates with the morgan access
  // line and any downstream handler logs.
  req.log.info({ source, bytes: req.rawBody?.length ?? 0 }, 'webhook received');

  // 2xx acknowledges receipt so providers don't retry. The verified payload
  // is intentionally dropped here — see the file-level comment above.
  res.status(202).json({ received: true, dispatched: false });
});
