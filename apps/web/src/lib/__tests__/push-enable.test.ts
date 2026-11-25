import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { enablePush, withTimeout } from '@/hooks/usePush';

// notification-box hang (owner 2026-11-25): on iPhone / iPad the permission
// question must be asked straight from the tap, and no wait may hang.
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const order: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); order.length = 0; vi.mocked(api.get).mockReset(); });

function stubBrowser(over: { perm?: NotificationPermission; ready?: Promise<unknown> } = {}) {
  vi.mocked(api.get).mockImplementation(async () => { order.push('key'); return { publicKey: 'BOrNk' }; });
  vi.mocked(api.post).mockResolvedValue({});
  const sub = { toJSON: () => ({ endpoint: 'https://push', keys: { p256dh: 'p', auth: 'a' } }) };
  const reg = { pushManager: { getSubscription: async () => sub } };
  vi.stubGlobal('Notification', { requestPermission: () => { order.push('permission'); return Promise.resolve(over.perm ?? 'granted'); } });
  vi.stubGlobal('navigator', { serviceWorker: { register: async () => reg, ready: over.ready ?? Promise.resolve(reg) } });
}

describe('enablePush', () => {
  it('asks for permission before any network wait, then turns on', async () => {
    stubBrowser();
    expect(await enablePush()).toBe('on');
    expect(order[0]).toBe('permission');
  });

  it('denied → blocked; dismissed → off (no hang)', async () => {
    stubBrowser({ perm: 'denied' });
    expect(await enablePush()).toBe('blocked');
    stubBrowser({ perm: 'default' });
    expect(await enablePush()).toBe('off');
  });

  it('a worker that never gets ready fails after its time limit instead of hanging', async () => {
    vi.useFakeTimers();
    stubBrowser({ ready: new Promise(() => {}) });
    const p = enablePush().catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await p).toBe('worker ready timed out');
  });

  it('withTimeout passes values and errors through', async () => {
    expect(await withTimeout(Promise.resolve(1), 10, 'x')).toBe(1);
    await expect(withTimeout(Promise.reject(new Error('no')), 10, 'x')).rejects.toThrow('no');
  });
});
