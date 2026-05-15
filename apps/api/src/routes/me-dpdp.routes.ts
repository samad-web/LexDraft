/**
 * Data-principal endpoints under `/api/me/dpdp/*`. Mounted by the orchestrator
 * behind `requireAuth`. Every handler operates against `req.user.id` - there
 * is no admin equivalent; one user, one principal, one export/deletion path.
 *
 * GET    /export           streams the user's data dump as an attachment
 * POST   /deletion-request schedules a soft-delete with a retention window
 * POST   /deletion-cancel  rolls back a pending deletion if within window
 * POST   /consent          appends to the consent ledger
 * GET    /consents         returns the consent history
 */

import { Router, type Request } from 'express';
import { z } from 'zod';
import { dpdpService } from '../services/dpdp.service';
import { UnauthorizedError } from '../lib/errors';

export const meDpdpRouter: Router = Router();

const DeletionRequestBody = z.object({
  retentionDays: z.number().int().positive().max(365).optional(),
});

const ConsentBody = z.object({
  consentType: z.string().min(1).max(64),
  consentVersion: z.string().min(1).max(32),
  granted: z.boolean(),
});

function requireUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw new UnauthorizedError('Authentication required');
  return id;
}

function clientIp(req: Request): string | null {
  const fwd = req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.ip ?? null;
}

function clientUa(req: Request): string | null {
  return req.header('user-agent') ?? null;
}

// ---- export -----------------------------------------------------------------
meDpdpRouter.get('/export', async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    req.log.info({ userId }, 'dpdp.export start');
    const payload = await dpdpService.exportUser(userId, {
      ip: clientIp(req),
      userAgent: clientUa(req),
    });
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="lexdraft-data-export-${date}.json"`);
    // Stream-friendly write: stringify in one shot - these are bounded by
    // per-firm row counts and the response is gated by an authenticated
    // session, so memory pressure is the user's own ceiling.
    res.end(JSON.stringify(payload, null, 2));
    req.log.info({ userId }, 'dpdp.export done');
  } catch (err) {
    next(err);
  }
});

// ---- deletion request -------------------------------------------------------
meDpdpRouter.post('/deletion-request', async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const body = DeletionRequestBody.parse(req.body ?? {});
    const result = await dpdpService.requestDeletion(
      userId,
      { retentionDays: body.retentionDays },
      { id: userId, email: req.user!.email },
    );
    req.log.info(
      { userId, scheduledPurgeAt: result.scheduledPurgeAt },
      'dpdp.deletion_requested',
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---- deletion cancel --------------------------------------------------------
meDpdpRouter.post('/deletion-cancel', async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    await dpdpService.cancelDeletion(userId, { id: userId, email: req.user!.email });
    req.log.info({ userId }, 'dpdp.deletion_cancelled');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- consent record ---------------------------------------------------------
meDpdpRouter.post('/consent', async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const body = ConsentBody.parse(req.body);
    const record = await dpdpService.recordConsent({
      userId,
      firmId: null, // resolved server-side from the user's firm membership
      consentType: body.consentType,
      consentVersion: body.consentVersion,
      granted: body.granted,
      ip: clientIp(req),
      userAgent: clientUa(req),
    });
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

// ---- consent list -----------------------------------------------------------
meDpdpRouter.get('/consents', async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    res.json({ items: await dpdpService.listConsents(userId) });
  } catch (err) {
    next(err);
  }
});
