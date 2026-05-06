import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not Found' });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', details: err.flatten() });
    return;
  }
  const status = (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number')
    ? (err.status as number)
    : 500;
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  if (status >= 500) logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(status).json({ error: message });
};
