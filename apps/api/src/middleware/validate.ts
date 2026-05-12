import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';

export interface ValidateSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Builds a request-validation middleware. Each provided schema is parsed and
 * the parsed value is written back onto `req.<part>` so route handlers see the
 * coerced/defaulted shape (e.g. `query.limit` becomes a number when the schema
 * uses `z.coerce.number()`).
 *
 * Errors propagate as `ZodError`; the existing error middleware turns them
 * into a 400 with `{ error, details }`.
 */
export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body)   req.body   = schemas.body.parse(req.body);
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        // express 5 makes req.query a getter; mutate via Object.assign to keep it writable across versions.
        Object.assign(req.query, parsed);
      }
      if (schemas.params) req.params = schemas.params.parse(req.params);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const idParam = z.object({ id: z.string().min(1) });
export const uuidParam = z.object({ id: z.string().uuid() });
