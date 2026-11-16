import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';

// The client portal and client messages were removed (features/remove-client-portal.md):
// no client sign-in, no client data, no advocate-side portal admin.
let server: Server;
let base = '';

beforeAll(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('Client portal removed', () => {
  it.each([
    ['POST', '/portal/auth/sign-in', { email: 'sayed@example.com', password: 'sayed@123' }],
    ['GET', '/portal/dashboard', undefined],
    ['GET', '/portal/messages', undefined],
    ['GET', '/portal/documents', undefined],
    ['GET', '/portal-admin/inbox', undefined],
    ['POST', '/portal-admin/clients/00000000-0000-0000-0000-000000000000/enable', {}],
  ])('%s /api%s no longer exists', async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // 404 for an unknown route, or 401 when a shared auth guard answers first: never 200.
    expect([401, 404]).toContain(res.status);
    if (res.status === 401) expect(path.startsWith('/portal-admin')).toBe(true);
  });
});
