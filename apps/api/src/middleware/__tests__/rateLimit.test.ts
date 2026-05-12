import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { perUserWriteLimit } from '../rateLimit';

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

  it('429s once a user exceeds the budget within a window', () => {
    const limit = perUserWriteLimit({ windowMs: 60_000, limit: 2 });
    const user = { id: 'u1', email: 'a@b', role: 'x', isSuperadmin: false };
    const ok1 = vi.fn() as unknown as NextFunction;
    const ok2 = vi.fn() as unknown as NextFunction;
    const blocked = vi.fn() as unknown as NextFunction;

    limit(mkReq({ user }), mkRes(), ok1);
    limit(mkReq({ user }), mkRes(), ok2);
    const res = mkRes();
    limit(mkReq({ user }), res, blocked);

    expect(ok1).toHaveBeenCalledWith();
    expect(ok2).toHaveBeenCalledWith();
    expect(blocked).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('separates buckets per user', () => {
    const limit = perUserWriteLimit({ windowMs: 60_000, limit: 1 });
    const a = { id: 'u-a', email: 'a@b', role: 'x', isSuperadmin: false };
    const b = { id: 'u-b', email: 'b@b', role: 'x', isSuperadmin: false };
    const nextA = vi.fn() as unknown as NextFunction;
    const nextB = vi.fn() as unknown as NextFunction;

    limit(mkReq({ user: a }), mkRes(), nextA);
    limit(mkReq({ user: b }), mkRes(), nextB);

    expect(nextA).toHaveBeenCalledWith();
    expect(nextB).toHaveBeenCalledWith();
  });

  it('falls back to IP when no user is attached', () => {
    const limit = perUserWriteLimit({ windowMs: 60_000, limit: 1 });
    const next = vi.fn() as unknown as NextFunction;
    const blocked = vi.fn() as unknown as NextFunction;

    limit(mkReq({ ip: '1.2.3.4' }), mkRes(), next);
    const res = mkRes();
    limit(mkReq({ ip: '1.2.3.4' }), res, blocked);

    expect(next).toHaveBeenCalledWith();
    expect(blocked).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
