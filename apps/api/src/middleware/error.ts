import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger';
import { isHttpError } from '../lib/errors';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not Found' });
};

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

  // Typed HTTP errors — status, code, and (when safe) details are taken
  // from the class instance. 4xx are exposed; 5xx fall through to opaque.
  if (isHttpError(err)) {
    if (err.status >= 500) {
      (req.log ?? logger).error(
        { err, path: req.path, method: req.method, code: err.code },
        'HttpError 5xx',
      );
      res.status(err.status).json({ error: 'Internal Server Error', code: err.code });
      return;
    }
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
    res.status(status).json({ error: 'Internal Server Error' });
    return;
  }
  res.status(status).json({ error: message });
};
