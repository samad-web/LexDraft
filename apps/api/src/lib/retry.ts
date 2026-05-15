/**
 * Retry an async operation with exponential backoff + jitter.
 *
 * Designed for outbound HTTP calls where transient failures (429, 5xx,
 * connection resets) are common and worth retrying, but client-side
 * failures (4xx besides 429) should fail fast - no point hammering an
 * API that's rejecting your credentials.
 *
 * `shouldRetry` decides whether a given error is retriable. The default
 * retries on HttpRetryError thrown by callers (typically with the
 * upstream status code attached) and on AbortError/network failures.
 */
export interface RetryOptions {
  attempts?: number;
  /** Base delay in ms. The nth retry waits ~base * 3^(n-1) plus jitter. */
  baseMs?: number;
  /** Max delay between attempts, capping exponential growth. */
  maxMs?: number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Optional hook - called on every retry (not the final failure). */
  onRetry?: (err: unknown, attempt: number, waitMs: number) => void;
}

const DEFAULT_RETRY = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: number }).status;
  if (typeof status === 'number') {
    return status === 429 || (status >= 500 && status < 600);
  }
  // Network-level errors don't surface a status - assume retriable.
  const code = (err as { code?: string }).code;
  if (typeof code === 'string') {
    return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'UND_ERR_SOCKET'].includes(code);
  }
  return false;
};

export async function withRetry<T>(op: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseMs = options.baseMs ?? 200;
  const maxMs = options.maxMs ?? 4000;
  const shouldRetry = options.shouldRetry ?? DEFAULT_RETRY;

  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (i === attempts || !shouldRetry(err, i)) throw err;
      // Full jitter: wait a random value in [0, expBackoff). Spreads
      // retries from many simultaneously-failing clients and avoids the
      // classic synchronized-retry stampede.
      const exp = Math.min(maxMs, baseMs * 3 ** (i - 1));
      const waitMs = Math.floor(Math.random() * exp);
      options.onRetry?.(err, i, waitMs);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

/** Helper for callers to throw a status-tagged error from a fetch wrapper. */
export class HttpRetryError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpRetryError';
    this.status = status;
  }
}
