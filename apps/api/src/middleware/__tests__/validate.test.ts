import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../validate';

function mkReq(overrides: Partial<Request>): Request {
  return { body: {}, query: {}, params: {}, ...overrides } as unknown as Request;
}

describe('validate middleware', () => {
  it('parses and replaces req.body when given a body schema', () => {
    const handler = validate({
      body: z.object({ count: z.coerce.number() }),
    });
    const req = mkReq({ body: { count: '7' } });
    const next = vi.fn() as unknown as NextFunction;
    handler(req, {} as Response, next);
    expect(req.body).toEqual({ count: 7 });
    expect(next).toHaveBeenCalledWith();
  });

  it('forwards ZodError to next on validation failure', () => {
    const handler = validate({
      body: z.object({ email: z.string().email() }),
    });
    const req = mkReq({ body: { email: 'not-an-email' } });
    const next = vi.fn() as unknown as NextFunction;
    handler(req, {} as Response, next);
    const arg = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0];
    expect(arg).toBeInstanceOf(Error);
    expect((arg as Error).name).toBe('ZodError');
  });

  it('coerces query parameters via z.coerce', () => {
    const handler = validate({
      query: z.object({ limit: z.coerce.number().int().positive() }),
    });
    const req = mkReq({ query: { limit: '25' } });
    const next = vi.fn() as unknown as NextFunction;
    handler(req, {} as Response, next);
    expect(req.query['limit']).toBe(25);
    expect(next).toHaveBeenCalledWith();
  });

  it('validates path params', () => {
    const handler = validate({
      params: z.object({ id: z.string().uuid() }),
    });
    const req = mkReq({ params: { id: 'not-a-uuid' } });
    const next = vi.fn() as unknown as NextFunction;
    handler(req, {} as Response, next);
    const arg = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0];
    expect(arg).toBeInstanceOf(Error);
  });
});
