import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { redis } from '../lib/redis';
import { logger } from '../logger';

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
  // Don't count successful sign-ins toward the limit - only failed attempts
  // burn budget, so a busy real user isn't punished.
  skipSuccessfulRequests: true,
  message: { error: 'Too many sign-in attempts. Try again in a few minutes.' },
});

// Sign-up is even tighter - there's no legitimate reason a single IP needs
// to create more than a handful of accounts per hour.
export const signUpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-up attempts from this IP. Try again later.' },
});

// Survey draft writes - one respondent can comfortably generate 30-60 PUTs
// across a full survey session (one per debounced answer change). 120/hour
// gives generous headroom for a single user without leaving the endpoint
// open to abuse. Keyed by IP since the public survey is unauthenticated.
export const surveyDraftLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many draft saves from this IP. Try again later.' },
});

// Token lookup limiter for the anonymous invitation-by-token endpoint. Tokens
// are random 20-128-char base64url strings — brute-force is infeasible at
// any sane rate, but a tight limiter raises the bar further and protects
// against scraping. 20/min/IP fits a legitimate "user opens the link they
// were emailed" pattern with headroom for retries.
export const tokenLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many lookups. Try again in a minute.' },
});

// MFA challenge limiter. The challenge endpoint is anonymous (pre-token
// MFA step) and accepts a short numeric/alphanumeric code — without a
// dedicated limiter the global IP cap is the only brake. Use the same
// strict bucket as sign-in.
export const mfaChallengeLimiter = signInLimiter;

// LLM-generation limiter. Each call costs real money on Anthropic/xAI, so a
// compromised account or a runaway script can rack up a bill fast. Keyed
// per-user (falls back to IP for the edge case where a route slips out of
// requireAuth) and caps at 30 generations per hour per user - well above
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
 * to the remote IP when the request is unauthenticated.
 *
 * Backend selection:
 *   - REDIS_URL set → atomic INCR + EXPIRE counter in Redis (multi-replica safe)
 *   - REDIS_URL unset → in-process Map (single replica only)
 *
 * Only POST/PUT/PATCH/DELETE are counted, so list/read traffic isn't blocked
 * by a chatty UI poll.
 */
export function perUserWriteLimit(opts: PerUserOptions) {
  const buckets = new Map<string, Bucket>();
  const sweepEvery = Math.max(opts.windowMs, 60_000);
  let lastSweep = Date.now();
  const windowSec = Math.max(1, Math.floor(opts.windowMs / 1000));

  async function checkRedis(key: string): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
    const client = await redis();
    if (!client) return { ok: true }; // fall back to in-memory branch below
    try {
      const ns = `rl:write:${opts.name ?? 'default'}:${key}`;
      const count = await client.incr(ns);
      if (count === 1) await client.expire(ns, windowSec);
      if (count > opts.limit) {
        const ttl = await client.ttl(ns);
        return { ok: false, retryAfter: ttl > 0 ? ttl : windowSec };
      }
      return { ok: true };
    } catch (err) {
      // Redis hiccup: degrade open rather than block writes. The in-memory
      // path below will pick up the slack on this replica.
      logger.warn({ err }, 'perUserWriteLimit: redis check failed; falling back');
      return { ok: true };
    }
  }

  function checkMemory(key: string): { ok: true } | { ok: false; retryAfter: number } {
    const now = Date.now();
    if (now - lastSweep > sweepEvery) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      lastSweep = now;
    }
    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return { ok: true };
    }
    if (existing.count >= opts.limit) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      return { ok: false, retryAfter };
    }
    existing.count += 1;
    return { ok: true };
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      next();
      return;
    }
    const key = req.user?.id || `ip:${req.ip}`;
    (async () => {
      const redisResult = await checkRedis(key);
      const decision = redisResult.ok ? checkMemory(key) : redisResult;
      if (!decision.ok) {
        res.setHeader('Retry-After', String(decision.retryAfter));
        res.status(429).json({
          error: opts.name
            ? `Rate limit exceeded (${opts.name}). Try again in ${decision.retryAfter}s.`
            : `Rate limit exceeded. Try again in ${decision.retryAfter}s.`,
        });
        return;
      }
      next();
    })().catch((err) => {
      logger.warn({ err }, 'perUserWriteLimit unexpected error; passing through');
      next();
    });
  };
}
