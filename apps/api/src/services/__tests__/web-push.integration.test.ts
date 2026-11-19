/**
 * web-push (build-docs/features/web-push.md): devices that turned
 * notifications on get every in-app notice in their notification bar.
 * Real Postgres; the push sender (web-push) is stubbed.
 */
import { vi } from 'vitest';

const wp = vi.hoisted(() => ({ sent: [] as Array<{ endpoint: string; payload: string }>, failWith: new Map<string, number>() }));
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => undefined,
    sendNotification: async (sub: { endpoint: string }, payload: string) => {
      const code = wp.failWith.get(sub.endpoint);
      if (code) throw Object.assign(new Error('push failed'), { statusCode: code });
      wp.sent.push({ endpoint: sub.endpoint, payload });
    },
  },
}));

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { env } from '../../env';
import { pushService } from '../push.service';
import { notificationsStore } from '../notifications.service';

const sql = () => getIntegrationSql();
const keys = { p256dh: 'BOr_p256dh_key_material_xxxxxxxx', auth: 'auth_secret_xx' };
let n = 0;
const ep = () => `https://fcm.googleapis.com/fcm/send/test-${Date.now()}-${++n}`;

beforeAll(() => {
  Object.assign(env, { VAPID_PUBLIC_KEY: 'BPub-test-key', VAPID_PRIVATE_KEY: 'priv-test-key' });
});
afterEach(() => { wp.sent.length = 0; wp.failWith.clear(); });

async function user() {
  const firm = await seedFirm(`Push ${Date.now()}-${++n}`, 'Firm');
  return seedUser(firm.id, { name: 'Asha Rao' });
}
const subsOf = async (userId: string) => sql()<{ endpoint: string }[]>`select endpoint from push_subscriptions where user_id = ${userId}::uuid`;
const waitFor = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 20)); };

describe('web-push', () => {
  it('AC1: a device subscribes; a new in-app notice is pushed to it with the page to open', async () => {
    const u = await user();
    const e = ep();
    await pushService.subscribe(u.id, { endpoint: e, keys }, 'Chrome Android');
    expect(await subsOf(u.id)).toEqual([{ endpoint: e }]);
    await notificationsStore.create({ firmId: u.firmId, userId: u.id, title: 'Hearing tomorrow: Rao v. State', body: 'Next hearing on 2030-01-15.', view: 'cases' });
    await waitFor(() => wp.sent.length > 0);
    expect(wp.sent).toHaveLength(1);
    expect(JSON.parse(wp.sent[0]!.payload)).toMatchObject({ title: 'Hearing tomorrow: Rao v. State', body: 'Next hearing on 2030-01-15.', url: '/app/cases' });
  });

  it('AC2: only https push endpoints are accepted', async () => {
    const u = await user();
    await expect(pushService.subscribe(u.id, { endpoint: 'http://10.0.0.1/x', keys })).rejects.toMatchObject({ status: 400 });
    expect(await subsOf(u.id)).toEqual([]);
  });

  it('AC3: a device the push service says is gone (410) is removed; others still get it', async () => {
    const u = await user();
    const gone = ep();
    const ok = ep();
    await pushService.subscribe(u.id, { endpoint: gone, keys });
    await pushService.subscribe(u.id, { endpoint: ok, keys });
    wp.failWith.set(gone, 410);
    expect(await pushService.sendToUser(u.id, { title: 'x' })).toBe(1);
    expect(await subsOf(u.id)).toEqual([{ endpoint: ok }]);
  });

  it('AC4: unsubscribe removes only your own device; no keys on the server = nothing sent', async () => {
    const a = await user();
    const b = await user();
    const e = ep();
    await pushService.subscribe(a.id, { endpoint: e, keys });
    await pushService.unsubscribe(b.id, e); // someone else cannot remove it
    expect(await subsOf(a.id)).toHaveLength(1);
    await pushService.unsubscribe(a.id, e);
    expect(await subsOf(a.id)).toEqual([]);

    const saved = env.VAPID_PRIVATE_KEY;
    Object.assign(env, { VAPID_PRIVATE_KEY: '' });
    try {
      await pushService.subscribe(a.id, { endpoint: ep(), keys });
      expect(pushService.publicKey()).toBeNull();
      expect(await pushService.sendToUser(a.id, { title: 'x' })).toBe(0);
    } finally {
      Object.assign(env, { VAPID_PRIVATE_KEY: saved });
    }
  });

  it('AC5: a device moves to whoever subscribes on it last (shared browser)', async () => {
    const a = await user();
    const b = await user();
    const e = ep();
    await pushService.subscribe(a.id, { endpoint: e, keys });
    await pushService.subscribe(b.id, { endpoint: e, keys });
    expect(await subsOf(a.id)).toEqual([]);
    expect(await subsOf(b.id)).toEqual([{ endpoint: e }]);
  });
});
