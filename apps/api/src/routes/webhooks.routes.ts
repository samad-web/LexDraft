import { Router } from 'express';
import { verifyWebhook } from '../services/webhooks.verify';
import { db } from '../db/client';
import { syncCaseFromEcourts } from '../services/case-sync.service';
import { applyPlanStatusUpdate, type PlanStatus } from '../services/plan-status.service';
import { notify } from '../services/notifications.service';

export const webhooksRouter: Router = Router();

// =============================================================================
// Inbound webhook router
// =============================================================================
// Every `:source` must have a corresponding WEBHOOK_SECRET_<UPPERCASE> in env;
// the body is verified against the `x-signature: sha256=<hex>` header before
// any downstream processing. Sources without a configured secret are rejected
// (503) unless the operator has set `WEBHOOK_ALLOW_UNVERIFIED=true` in a
// non-prod env.
//
// Per-source dispatch below. `esign` has no provider wired yet (no e-sign
// schema exists anywhere in the product) — it verifies and acknowledges
// honestly without pretending to persist anything. `ecourts` and `payment`
// do real work. See dispatchWebhook() for the payload shape each expects.
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

  // 2xx acknowledges receipt immediately so providers don't retry on a slow
  // downstream call. Dispatch runs after the response is sent — a dispatch
  // failure is logged, never surfaced to the provider as a delivery failure,
  // since by then we've already told them we received it.
  res.status(202).json({ received: true, dispatched: true });

  dispatchWebhook(source, req.body as Record<string, unknown>, req.log).catch((err) => {
    req.log.error({ err, source }, 'webhook dispatch failed');
  });
});

/** Exported for unit tests — not part of the route's public HTTP contract. */
export async function dispatchWebhook(
  source: string,
  body: Record<string, unknown>,
  log: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void },
): Promise<void> {
  switch (source) {
    case 'ecourts': {
      // Expected payload: { cnr: string }. eCourts pushes a CNR when a case's
      // record changes; we resolve it to our internal case + firm and run the
      // same per-case sync the nightly job uses, rather than re-implementing
      // the eCourts fetch/diff logic here.
      const cnr = typeof body.cnr === 'string' ? body.cnr.trim().toUpperCase() : '';
      if (!cnr) {
        log.warn({ source, body }, 'ecourts webhook: missing cnr, skipping');
        return;
      }
      const sql = db();
      if (!sql) return;
      const rows = await sql<Array<{ id: string; firm_id: string }>>`
        select id, firm_id from cases where cnr = ${cnr} limit 1
      `;
      const match = rows[0];
      if (!match) {
        log.warn({ source, cnr }, 'ecourts webhook: no matching case, skipping');
        return;
      }
      await syncCaseFromEcourts(match.id, match.firm_id);
      log.info({ source, cnr, caseId: match.id }, 'ecourts webhook: case synced');
      return;
    }

    case 'payment': {
      // Expected payload: { firmId: string, status: 'active'|'past_due'|
      // 'cancelled'|'trial', renewsAt?: string (ISO date) }. There is no
      // payment-gateway integration behind this yet (no Razorpay/Stripe
      // code in the repo) — this handler is ready for whichever provider
      // gets wired up, since the shape it expects is provider-agnostic.
      const firmId = typeof body.firmId === 'string' ? body.firmId : '';
      const status = body.status as PlanStatus;
      const validStatuses: PlanStatus[] = ['trial', 'active', 'past_due', 'cancelled'];
      if (!firmId || !status || !validStatuses.includes(status)) {
        log.warn({ source, body }, 'payment webhook: invalid payload, skipping');
        return;
      }
      const renewsAt = typeof body.renewsAt === 'string' ? new Date(body.renewsAt) : null;
      const applied = await applyPlanStatusUpdate(firmId, { planStatus: status, renewsAt });
      if (!applied) {
        log.warn({ source, firmId }, 'payment webhook: firm not found, skipping');
        return;
      }
      await notify.planStatusChanged(firmId, {
        planStatus: status,
        renewsAt: renewsAt ? renewsAt.toISOString().slice(0, 10) : null,
      });
      log.info({ source, firmId, status }, 'payment webhook: plan status updated');
      return;
    }

    case 'esign': {
      // No e-sign provider is integrated anywhere in the product (engine's
      // e-filing bundle explicitly doesn't implement it, no signature-status
      // column exists on any table). Acknowledging without a fabricated side
      // effect is the honest behavior until that feature actually exists.
      log.info({ source }, 'esign webhook: verified and acknowledged, no provider wired yet');
      return;
    }

    default:
      log.warn({ source }, 'webhook: unrecognized source, acknowledged but not dispatched');
  }
}
