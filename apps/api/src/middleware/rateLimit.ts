import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';

interface Bucket {
  count: number;
  resetAt: number;
}

// Narrow limiter for sign-in / sign-up. Keyed by IP because there's no
// authenticated user yet at this point. 10 attempts per 15 minutes makes
// online password-guessing impractical without locking out a real user who
// fat-fingers their password a couple of times.
export const signInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Don't count successful sign-ins toward the limit — only failed attempts
  // burn budget, so a busy real user isn't punished.
  skipSuccessfulRequests: true,
  message: { error: 'Too many sign-in attempts. Try again in a few minutes.' },
});

// Sign-up is even tighter — there's no legitimate reason a single IP needs
// to create more than a handful of accounts per hour.
export const signUpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-up attempts from this IP. Try again later.' },
});

// LLM-generation limiter. Each call costs real money on Anthropic/xAI, so a
// compromised account or a runaway script can rack up a bill fast. Keyed
// per-user (falls back to IP for the edge case where a route slips out of
// requireAuth) and caps at 30 generations per hour per user — well above
// normal usage, well below "expensive accident" territory.
export const llmGenerationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? `ip:${req.ip}`,
  message: {
    error: 'Hourly drafting quota reached. Try again in a bit, or contact your firm admin to raise the limit.',
  },
});

interface PerUserOptions {
  /** Window length in ms. */
  windowMs: number;
  /** Max writes per user per window. */
  limit: number;
  /** Optional name shown in logs / error responses. */
  name?: string;
}

/**
 * Per-user rate limiter for write traffic. Keys on `req.user.id`; falls back
 * to the remote IP when the request is unauthenticated (so the existing
 * IP-level limiter still catches anonymous abuse). Lives in-process — replace
 * the bucket map with Redis if/when we run multiple API replicas.
 *
 * Only POST/PUT/PATCH/DELETE are counted, so list/read traffic isn't blocked
 * by a chatty UI poll.
 */
export function perUserWriteLimit(opts: PerUserOptions) {
  const buckets = new Map<string, Bucket>();
  const sweepEvery = Math.max(opts.windowMs, 60_000);
  let lastSweep = Date.now();

  return (req: Request, res: Response, next: NextFunction): void => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      next();
      return;
    }

    const now = Date.now();
    if (now - lastSweep > sweepEvery) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      lastSweep = now;
    }

    const key = req.user?.id || `ip:${req.ip}`;
    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    if (existing.count >= opts.limit) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: opts.name
          ? `Rate limit exceeded (${opts.name}). Try again in ${retryAfter}s.`
          : `Rate limit exceeded. Try again in ${retryAfter}s.`,
      });
      return;
    }
    existing.count += 1;
    next();
  };
}
