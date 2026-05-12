import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuditAction, AuditTargetType } from '@lexdraft/types';
import { auditService } from '../services/audit.service';
import { logger } from '../logger';

interface AuditOptions {
  action: AuditAction;
  targetType: AuditTargetType;
  /** Pull the target id from params/body/response. Default: read `id` from
   *  the route params, falling back to the response body's `id` field. */
  targetId?: (req: Request, resBody: unknown) => string | null | undefined;
  /** Build the JSON payload. Default: include the request body and response
   *  body when both are objects, otherwise just the request body. */
  payload?: (req: Request, resBody: unknown) => unknown;
  /** Skip the audit when this returns true (e.g. dry-run query parameter). */
  skip?: (req: Request) => boolean;
}

function defaultTargetId(req: Request, resBody: unknown): string | null | undefined {
  if (req.params && typeof req.params['id'] === 'string') return req.params['id'];
  if (resBody && typeof resBody === 'object' && 'id' in (resBody as Record<string, unknown>)) {
    const v = (resBody as Record<string, unknown>)['id'];
    return typeof v === 'string' ? v : null;
  }
  return null;
}

function defaultPayload(req: Request, resBody: unknown): unknown {
  const out: Record<string, unknown> = {};
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
    out['request'] = req.body;
  }
  if (resBody && typeof resBody === 'object') {
    out['response'] = resBody;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Records an audit-log entry on successful (2xx) responses. Captures the
 * response body via a `res.json` shim so we can include the persisted record's
 * id in the entry without forcing handlers to plumb the actor through.
 *
 * Failures are logged but never block the response — auditing is observability
 * grade, not a correctness gate.
 */
export function withAudit(opts: AuditOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (opts.skip?.(req)) {
      next();
      return;
    }
    let captured: unknown = undefined;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      captured = body;
      return originalJson(body);
    }) as typeof res.json;

    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      const user = req.user;
      if (!user) return; // anonymous writes (e.g. invitation accept) audit elsewhere

      const targetId = (opts.targetId ?? defaultTargetId)(req, captured) ?? null;
      const payload = (opts.payload ?? defaultPayload)(req, captured);

      auditService
        .write({
          actorUserId: user.actAs?.adminId ?? user.id,
          actorEmail: user.actAs?.adminEmail ?? user.email,
          action: opts.action,
          targetType: opts.targetType,
          targetId,
          payload,
        })
        .catch((err) => {
          logger.warn({ err, action: opts.action, targetType: opts.targetType }, 'audit write failed');
        });
    });

    next();
  };
}
