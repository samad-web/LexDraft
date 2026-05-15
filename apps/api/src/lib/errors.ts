/**
 * HTTP-aware error taxonomy. Services and middleware throw these instead of
 * stringly-typed `Object.assign(new Error(...), { status: 4xx })` - the
 * central error handler in middleware/error.ts maps each subclass to its
 * correct response status, message, and (optional) detail payload.
 *
 * Generic `Error` instances continue to surface as 500s, so this is
 * additive: existing throw-sites keep working until they're migrated.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly expose: boolean;

  constructor(status: number, message: string, opts: { code?: string; details?: unknown; expose?: boolean } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = opts.code ?? this.constructor.name;
    this.details = opts.details;
    // 4xx errors are safe to surface verbatim; 5xx default to opaque.
    this.expose = opts.expose ?? status < 500;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Bad request', opts?: { code?: string; details?: unknown }) {
    super(400, message, opts);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Authentication required', opts?: { code?: string; details?: unknown }) {
    super(401, message, opts);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden', opts?: { code?: string; details?: unknown }) {
    super(403, message, opts);
  }
}

export class PaymentRequiredError extends HttpError {
  constructor(message = 'Payment required', opts?: { code?: string; details?: unknown }) {
    super(402, message, opts);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found', opts?: { code?: string; details?: unknown }) {
    super(404, message, opts);
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'Conflict', opts?: { code?: string; details?: unknown }) {
    super(409, message, opts);
  }
}

export class UnprocessableEntityError extends HttpError {
  constructor(message = 'Unprocessable entity', opts?: { code?: string; details?: unknown }) {
    super(422, message, opts);
  }
}

export class TooManyRequestsError extends HttpError {
  constructor(message = 'Too many requests', opts?: { code?: string; details?: unknown }) {
    super(429, message, opts);
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}
