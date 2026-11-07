import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

// Force the deterministic in-memory branch: with no Redis client the limiter
// uses its in-process Map. (In CI/dev there is no Redis, so this also matches
// how the middleware actually runs here.) Must be mocked before importing the
// middleware so the module picks up the mock.
vi.mock('../../lib/redis', () => ({
  redis: vi.fn(async () => null),
}));

import express from 'express';
import type { AddressInfo } from 'node:net';
import { apiIpLimiter, perUserWriteLimit } from '../rateLimit';

/** The limiter decides inside an async IIFE (it awaits the Redis check before
 *  calling next()/status()). Flush the microtask queue so the decision has run
 *  before we assert. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function mkReq(overrides: Partial<Request>): Request {
  return { method: 'POST', ip: '127.0.0.1', user: undefined, ...overrides } as unknown as Request;
}

function mkRes(): Response {
  const res: Partial<Response> = {};
  res.setHeader = vi.fn();
  res.status = vi.fn(() => res as Response);
  res.json = vi.fn(() => res as Response);
  return res as Response;
}

describe('perUserWriteLimit', () => {
  it('skips read methods entirely', () => {
    const limit = perUserWriteLimit({ windowMs: 1_000, limit: 1 });
    const next = vi.fn() as unknown as NextFunction;
    limit(mkReq({ method: 'GET' }), mkRes(), next);
    limit(mkReq({ method: 'GET' }), mkRes(), next);
    limit(mkReq({ method: 'GET' }), mkRes(), next);
    expect((next as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(3);
  });

  it('429s once a user exceeds the budget within a window', async () => {
    const limit = perUserWriteLimit({ windowMs: 60_000, limit: 2 });
    const user = { id: 'u1', email: 'a@b', role: 'x', isSuperadmin: false };
    const ok1 = vi.fn() as unknown as NextFunction;
    const ok2 = vi.fn() as unknown as NextFunction;
    const blocked = vi.fn() as unknown as NextFunction;

    limit(mkReq({ user }), mkRes(), ok1);
    await flush();
    limit(mkReq({ user }), mkRes(), ok2);
    await flush();
    const res = mkRes();
    limit(mkReq({ user }), res, blocked);
    await flush();

    expect(ok1).toHaveBeenCalledWith();
    expect(ok2).toHaveBeenCalledWith();
    expect(blocked).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('separates buckets per user', async () => {
    const limit = perUserWriteLimit({ windowMs: 60_000, limit: 1 });
    const a = { id: 'u-a', email: 'a@b', role: 'x', isSuperadmin: false };
    const b = { id: 'u-b', email: 'b@b', role: 'x', isSuperadmin: false };
    const nextA = vi.fn() as unknown as NextFunction;
    const nextB = vi.fn() as unknown as NextFunction;

    limit(mkReq({ user: a }), mkRes(), nextA);
    await flush();
    limit(mkReq({ user: b }), mkRes(), nextB);
    await flush();

    expect(nextA).toHaveBeenCalledWith();
    expect(nextB).toHaveBeenCalledWith();
  });

  it('falls back to IP when no user is attached', async () => {
    const limit = perUserWriteLimit({ windowMs: 60_000, limit: 1 });
    const next = vi.fn() as unknown as NextFunction;
    const blocked = vi.fn() as unknown as NextFunction;

    limit(mkReq({ ip: '1.2.3.4' }), mkRes(), next);
    await flush();
    const res = mkRes();
    limit(mkReq({ ip: '1.2.3.4' }), res, blocked);
    await flush();

    expect(next).toHaveBeenCalledWith();
    expect(blocked).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });
});

// drafting-efficiency: the progress poll must not spend the shared office IP budget.
describe('apiIpLimiter', () => {
  async function withServer(run: (get: (path: string, method?: string) => Promise<number>) => Promise<void>) {
    const app = express();
    app.use('/api', apiIpLimiter(2));
    app.get('/api/drafting/progress', (_req, res) => { res.json({ stage: null }); });
    app.get('/api/cases', (_req, res) => { res.json([]); });
    app.post('/api/drafting/progress', (_req, res) => { res.json({}); });
    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
      await run(async (path, method = 'GET') => (await fetch(`http://127.0.0.1:${port}${path}`, { method })).status);
    } finally {
      server.close();
    }
  }

  it('progress polls do not consume the IP budget', async () => {
    await withServer(async (get) => {
      for (let i = 0; i < 5; i++) expect(await get('/api/drafting/progress')).toBe(200);
      expect(await get('/api/cases')).toBe(200);
      expect(await get('/api/cases')).toBe(200);
      expect(await get('/api/cases')).toBe(429);
    });
  });

  it('progress polls still answer after the budget is spent', async () => {
    await withServer(async (get) => {
      await get('/api/cases');
      await get('/api/cases');
      expect(await get('/api/cases')).toBe(429);
      expect(await get('/api/drafting/progress')).toBe(200);
    });
  });

  it('only GET on the exact progress path is exempt', async () => {
    await withServer(async (get) => {
      const post = (p: string) => get(p, 'POST');
      expect(await post('/api/drafting/progress')).toBe(200);
      expect(await post('/api/drafting/progress')).toBe(200);
      expect(await post('/api/drafting/progress')).toBe(429);
      expect(await get('/api/drafting/progress-x')).toBe(429);
    });
  });
});
