import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';
import { logger } from '../logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Stable per-request correlation id. Mirrored in the response as
       *  `x-request-id` so clients can quote it in support tickets. */
      id: string;
      /** Pino child logger bound to this request's id, method, and URL.
       *  Prefer this over the module-level `logger` inside handlers — log
       *  lines stay correlatable across the full request lifecycle. */
      log: Logger;
    }
  }
}

/**
 * Attaches `req.id` (forwarded from `x-request-id` when an upstream proxy
 * supplied it, otherwise minted fresh) and `req.log` (pino child) to every
 * incoming request. Mount BEFORE morgan / route handlers so every downstream
 * log line carries the correlation id.
 *
 * Header forwarding lets a load balancer or CDN stamp the id at the edge
 * and have every internal service log it consistently — no separate
 * tracing system needed for the basic "what happened in this request"
 * question.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  // Trust an upstream id only if it looks reasonable — reject malicious
  // huge or non-printable payloads so the field is safe to log.
  const inbound = req.header('x-request-id');
  const id = inbound && /^[A-Za-z0-9_.:-]{8,128}$/.test(inbound) ? inbound : randomUUID();

  req.id = id;
  req.log = logger.child({ reqId: id, method: req.method, url: req.originalUrl });
  res.setHeader('x-request-id', id);
  next();
}
