/**
 * /api/me/mfa/* — TOTP enrolment, verification, and teardown.
 *
 * Mounted by the orchestrator behind `requireAuth`, so every handler can
 * trust `req.user` is set. Tenant scoping is implicit (all calls act on
 * the caller's own user row).
 *
 * Endpoints:
 *   POST   /enroll/start         start enrolment, return secret + QR
 *   POST   /enroll/confirm       finish enrolment, return backup codes
 *   POST   /verify               verify a code, return a fresh JWT carrying mfaVerifiedAt
 *   POST   /verify-challenge     exchange a sign-in challengeId for a JWT
 *   GET    /status               { enrolled, required }
 *   DELETE /                     self-disable (or superadmin-on-other via admin route, separate)
 */

import { Router } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { mfaService } from '../services/mfa.service';
import { UnauthorizedError, NotFoundError } from '../lib/errors';
import type { MfaVerifyResponse } from '../types/mfa.types';

const ConfirmBody = z.object({
  challengeId: z.string().uuid(),
  code: z.string().min(4).max(16),
});

const VerifyBody = z.object({
  code: z.string().min(4).max(32),
});

const VerifyChallengeBody = z.object({
  challengeId: z.string().uuid(),
  code: z.string().min(4).max(32),
});

export const meMfaRouter: Router = Router();

meMfaRouter.post('/enroll/start', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const out = await mfaService.enrollStart(userId);
    res.json(out);
  } catch (err) { next(err); }
});

meMfaRouter.post('/enroll/confirm', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const body = ConfirmBody.parse(req.body);
    const out = await mfaService.enrollConfirm(userId, body.challengeId, body.code);
    res.json(out);
  } catch (err) { next(err); }
});

/**
 * Verify a TOTP/backup code for the CURRENT logged-in user. On success
 * return a fresh JWT carrying `mfaVerifiedAt` so downstream `requireMfa`
 * middleware lets the user through. The client should replace its stored
 * bearer with this new token.
 */
meMfaRouter.post('/verify', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const body = VerifyBody.parse(req.body);

    const ok = await mfaService.verifyTotp(userId, body.code);
    if (!ok) throw new UnauthorizedError('Invalid TOTP code', { code: 'mfa_code_invalid' });

    const user = await authService.getById(userId);
    if (!user) throw new NotFoundError('User not found');

    const token = authService.issueTokenWithMfa(user);
    const response: MfaVerifyResponse = { token };
    res.json(response);
  } catch (err) { next(err); }
});

/**
 * Exchange the sign-in challengeId (returned by signIn when MFA is enrolled)
 * + a TOTP code for a full session token. This is an UNAUTHENTICATED
 * endpoint (the client has no token yet) — the challengeId stands in for
 * "I have already proved my password to this server in the last 5 minutes".
 *
 * Mounted under /api/me/mfa for path locality; orchestrator should
 * special-case this one to skip requireAuth, OR alternatively the
 * orchestrator can mount this under /api/auth/mfa/verify-challenge — see
 * the report for the tradeoff. The handler itself does not require auth.
 */
meMfaRouter.post('/verify-challenge', async (req, res, next) => {
  try {
    const body = VerifyChallengeBody.parse(req.body);
    const userId = await mfaService.consumeSignInChallenge(body.challengeId, body.code);
    const user = await authService.getById(userId);
    if (!user) throw new NotFoundError('User not found');
    const token = authService.issueTokenWithMfa(user);
    const response: MfaVerifyResponse = { token };
    res.json(response);
  } catch (err) { next(err); }
});

meMfaRouter.get('/status', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    res.json(await mfaService.mfaStatus(userId));
  } catch (err) { next(err); }
});

/**
 * Self-disable. The orchestrator will likely wire a separate
 * /admin/users/:id/mfa endpoint for superadmin teardown of OTHER users —
 * this one only tears down the caller's own factor.
 *
 * For Firm Admin / superadmin roles the UI should warn that re-enrolment
 * is mandatory on next sign-in, but the disable itself is allowed (and is
 * sometimes the only way to recover from a lost device when the user
 * still has working session credentials).
 */
meMfaRouter.delete('/', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    await mfaService.disableForUser(userId);
    res.status(204).end();
  } catch (err) { next(err); }
});

