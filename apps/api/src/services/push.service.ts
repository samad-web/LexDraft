import webpush from 'web-push';
import { db } from '../db/client';
import { env } from '../env';
import { BadRequestError } from '../lib/errors';
import { logger } from '../logger';
import { sendFcm } from '../lib/fcm';

// =============================================================================
// web-push (owner 2026-11-19, build-docs/features/web-push.md): every in-app
// notification is also shown in the phone/computer notification bar on the
// devices where the user turned it on. Needs VAPID keys in the server env;
// without them everything here is a quiet no-op.
// =============================================================================

export const pushEnabled = (): boolean => !!(env.VAPID_PUBLIC_KEY.trim() && env.VAPID_PRIVATE_KEY.trim());

let configured = false;
function configure(): boolean {
  if (!pushEnabled()) return false;
  if (!configured) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY.trim(), env.VAPID_PRIVATE_KEY.trim());
    configured = true;
  }
  return true;
}

export interface PushSubscriptionInput { endpoint: string; keys: { p256dh: string; auth: string } }

/** Only real push services over https; never a plain-http or odd URL. */
function assertEndpoint(endpoint: string): void {
  let u: URL;
  try { u = new URL(endpoint); } catch { throw new BadRequestError('Invalid push subscription.'); }
  if (u.protocol !== 'https:') throw new BadRequestError('Invalid push subscription.');
}

export const pushService = {
  publicKey: (): string | null => (pushEnabled() ? env.VAPID_PUBLIC_KEY.trim() : null),

  async subscribe(userId: string, sub: PushSubscriptionInput, userAgent?: string): Promise<void> {
    assertEndpoint(sub.endpoint);
    const sql = db();
    if (!sql) return;
    // A device belongs to whoever subscribed last on it (shared browser, new sign-in).
    await sql`
      insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
      values (${userId}::uuid, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth}, ${(userAgent ?? '').slice(0, 300)})
      on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now()`;
  },

  /** The Android app's FCM token (android-push.md). Stored even while FCM is
   *  not configured, so devices work as soon as the server key is added. */
  async subscribeNative(userId: string, token: string, userAgent?: string): Promise<void> {
    const sql = db();
    if (!sql) return;
    await sql`
      insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, kind)
      values (${userId}::uuid, ${token}, '', '', ${(userAgent ?? '').slice(0, 300)}, 'fcm')
      on conflict (endpoint) do update set user_id = excluded.user_id, user_agent = excluded.user_agent, kind = 'fcm', created_at = now()`;
  },

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    const sql = db();
    if (!sql) return;
    await sql`delete from push_subscriptions where user_id = ${userId}::uuid and endpoint = ${endpoint}`;
  },

  /** Push one notification to every device of `userId`. Never throws; devices
   *  the push service reports gone (404/410) are removed. */
  async sendToUser(userId: string, msg: { title: string; body?: string; view?: string; tag?: string }): Promise<number> {
    const sql = db();
    if (!sql) return 0;
    const webOn = configure();
    let sent = 0;
    try {
      const subs = await sql<Array<{ id: string; endpoint: string; p256dh: string; auth: string; kind: string }>>`
        select id, endpoint, p256dh, auth, kind from push_subscriptions where user_id = ${userId}::uuid`;
      const note = {
        title: msg.title.slice(0, 120),
        body: (msg.body ?? '').slice(0, 300),
        url: `/app/${(msg.view ?? 'dashboard').replace(/^\/+/, '')}`,
        tag: msg.tag,
      };
      const payload = JSON.stringify(note);
      for (const s of subs) {
        if (s.kind === 'fcm') {
          const r = await sendFcm(s.endpoint, note);
          if (r === 'sent') { sent += 1; await sql`update push_subscriptions set last_ok_at = now() where id = ${s.id}::uuid`; }
          else if (r === 'gone') await sql`delete from push_subscriptions where id = ${s.id}::uuid`;
          continue;
        }
        if (!webOn) continue;
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600, urgency: 'high' });
          sent += 1;
          await sql`update push_subscriptions set last_ok_at = now() where id = ${s.id}::uuid`;
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await sql`delete from push_subscriptions where id = ${s.id}::uuid`;
          else logger.warn({ err: (err as Error).message, code }, 'web push failed');
        }
      }
    } catch (err) {
      logger.warn({ err, userId }, 'web push lookup failed');
    }
    return sent;
  },
};
