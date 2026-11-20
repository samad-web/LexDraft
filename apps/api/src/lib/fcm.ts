import jwt from 'jsonwebtoken';
import { env } from '../env';
import { logger } from '../logger';

// =============================================================================
// Firebase Cloud Messaging (HTTP v1) for the Android app
// (build-docs/features/android-push.md). FCM_SERVICE_ACCOUNT = base64 of the
// Firebase service-account JSON. Without it, sending is a quiet no-op.
// The OAuth token comes from a service-account JWT signed with the installed
// jsonwebtoken - no Firebase SDK needed.
// =============================================================================

interface ServiceAccount { project_id: string; client_email: string; private_key: string }

let account: ServiceAccount | null | undefined;
function serviceAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  const raw = env.FCM_SERVICE_ACCOUNT.trim();
  account = null;
  if (!raw) return account;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Partial<ServiceAccount>;
    if (parsed.project_id && parsed.client_email && parsed.private_key) account = parsed as ServiceAccount;
    else logger.warn('FCM_SERVICE_ACCOUNT is missing project_id/client_email/private_key');
  } catch {
    logger.warn('FCM_SERVICE_ACCOUNT is not base64 JSON');
  }
  return account;
}

export const fcmEnabled = (): boolean => !!serviceAccount();

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Claims of the service-account assertion exchanged for an access token. */
export function assertionClaims(clientEmail: string, nowSec: number): Record<string, string | number> {
  return { iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 };
}

let cached: { token: string; until: number } | null = null;
async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const assertion = jwt.sign(assertionClaims(sa.client_email, Math.floor(Date.now() / 1000)), sa.private_key, { algorithm: 'RS256' });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`FCM auth failed (${res.status})`);
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 600) * 1000 };
  return cached.token;
}

/** FCM's answer for a token that will never work again: remove it. */
export function isDeadToken(status: number, body: string): boolean {
  return status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(body)
    || (status === 400 && /INVALID_ARGUMENT/.test(body) && /token/i.test(body));
}

export type FcmResult = 'sent' | 'gone' | 'failed' | 'off';

export async function sendFcm(token: string, msg: { title: string; body: string; url: string; tag?: string }): Promise<FcmResult> {
  const sa = serviceAccount();
  if (!sa) return 'off';
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken(sa)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: msg.title, body: msg.body },
          data: { url: msg.url },
          android: { priority: 'high', notification: { ...(msg.tag ? { tag: msg.tag.slice(0, 64) } : {}), default_sound: true } },
        },
      }),
    });
    if (res.ok) return 'sent';
    const text = await res.text();
    if (isDeadToken(res.status, text)) return 'gone';
    logger.warn({ status: res.status, body: text.slice(0, 300) }, 'FCM send failed');
    return 'failed';
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'FCM send error');
    return 'failed';
  }
}
