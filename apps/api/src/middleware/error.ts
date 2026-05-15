import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger';
import { isHttpError } from '../lib/errors';
import { errorLogService } from '../services/error-log.service';
import { firmIdForUser } from '../services/tenant';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not Found' });
};

/**
 * Status codes we persist into `error_log`. Everything 5xx is captured
 * unconditionally (operator's primary signal). A curated subset of 4xx
 * is captured too:
 *   403 - authorisation failures. Repeated 403s from one user are the
 *         standard probing pattern; we want them surfaceable.
 *   422 - semantic validation rejections (vs. 400 schema rejections).
 *         Often points to a broken client integration.
 *   429 - rate-limit hits. Useful for spotting runaway clients before
 *         they degrade neighbours.
 * We deliberately exclude:
 *   400 - Zod schema failures. High volume, low signal.
 *   401 - unauthenticated. Browsers retry constantly; floods the table.
 *   404 - typo'd URLs, missing rows. Routine, no diagnostic value.
 */
function shouldCapture(status: number): boolean {
  return status >= 500 || status === 403 || status === 422 || status === 429;
}

/** Fire `errorLogService.capture(...)` without awaiting it from the
 *  middleware. We resolve `firmId` from the user before the insert so the
 *  viewer can scope by tenant. The whole chain is wrapped in a swallowing
 *  `.catch` - capture itself never throws, but the firm-id lookup might. */
function captureAsync(req: import('express').Request, status: number, err: unknown): void {
  const userId = req.user?.id;
  const requestId = req.id;
  const userAgent = req.header('user-agent') ?? null;
  // Best-effort client IP. `req.ip` honours `trust proxy` if it's been
  // configured; if not, it falls back to the socket address.
  const ip = req.ip ?? null;
  const method = req.method;
  const path = req.path;

  // Don't try to dump req.body unconditionally - handlers downstream of
  // parsers may have streams, raw buffers, or just very large payloads.
  // Persist the headers (minus pino-redacted ones) and the query string;
  // the scrubber will strip credential-shaped fields.
  const context: Record<string, unknown> = {
    query: req.query,
    params: req.params,
  };

  void (async () => {
    let firmId: string | null = null;
    try {
      if (userId) firmId = await firmIdForUser(userId);
    } catch {
      // Firm resolution is best-effort. Leave firmId null on failure.
      firmId = null;
    }
    await errorLogService.capture({
      requestId,
      userId: userId ?? null,
      firmId,
      method,
      path,
      status,
      error: err,
      userAgent,
      ip,
      context,
    });
  })().catch(() => {
    // errorLogService.capture is already non-throwing, but we add a
    // belt-and-braces catch on the IIFE so a programming bug here can never
    // become an unhandled promise rejection that crashes the process.
  });
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Zod schema rejection → standardized 400 with flattened details.
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.flatten(),
    });
    return;
  }

  // Typed HTTP errors - status, code, and (when safe) details are taken
  // from the class instance. 4xx are exposed; 5xx fall through to opaque.
  if (isHttpError(err)) {
    if (err.status >= 500) {
      (req.log ?? logger).error(
        { err, path: req.path, method: req.method, code: err.code },
        'HttpError 5xx',
      );
      if (shouldCapture(err.status)) captureAsync(req, err.status, err);
      res.status(err.status).json({ error: 'Internal Server Error', code: err.code });
      return;
    }
    if (shouldCapture(err.status)) captureAsync(req, err.status, err);
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  // Legacy throw-sites that attach `.status` to a plain Error. Mapped the
  // same way so the migration to typed errors can be incremental.
  const status = (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number')
    ? (err.status as number)
    : 500;
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  if (status >= 500) {
    (req.log ?? logger).error({ err, path: req.path, method: req.method }, 'Unhandled error');
    if (shouldCapture(status)) captureAsync(req, status, err);
    res.status(status).json({ error: 'Internal Server Error' });
    return;
  }
  if (shouldCapture(status)) captureAsync(req, status, err);
  res.status(status).json({ error: message });
};
