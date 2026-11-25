import { isIosDevice, isStandalone } from '@/lib/ios';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

// web-push (owner 2026-11-19): show DifAi notifications in the phone /
// computer notification bar. Android Chrome and desktop browsers work in the
// browser; iPhone only after "Add to Home Screen" (iOS 16.4+).

export type PushState = 'unsupported' | 'ios-install' | 'off' | 'on' | 'blocked' | 'unavailable';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// iPadOS reports itself as a Mac: lib/ios tells them apart (ios-web-app).
const isIos = () => isIosDevice();
const standalone = () => isStandalone();

/** Register the worker once (no caching in it; push only). */
export function registerPushWorker(): void {
  if (!supported()) return;
  void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

function keyBytes(base64url: string): ArrayBuffer {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const b = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out.buffer;
}

/** Rejects when `p` takes longer than `ms` (a wait must never hang the button). */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Turn notifications on. Must run from a tap. iPhone / iPad only show the
 *  permission question when it is asked straight from the tap, before any
 *  network wait (asked after one, iOS may never answer and the button hung on
 *  "Turning on…"), so permission comes first and every later wait has a limit. */
export async function enablePush(): Promise<PushState> {
  const permission = Notification.requestPermission();
  const key = api.get<{ publicKey: string | null }>('/notifications/push/key');
  key.catch(() => undefined); // read below; never an unhandled rejection
  const perm = await withTimeout(permission, 120_000, 'permission').catch(() => 'default' as NotificationPermission);
  if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'off';
  const { publicKey } = await withTimeout(key, 20_000, 'push key');
  if (!publicKey) return 'unavailable';
  const reg = await withTimeout(navigator.serviceWorker.register('/sw.js'), 20_000, 'worker');
  await withTimeout(navigator.serviceWorker.ready, 20_000, 'worker ready');
  const sub = (await reg.pushManager.getSubscription())
    ?? await withTimeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }), 30_000, 'subscribe');
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.post('/notifications/push/subscription', { endpoint: json.endpoint, keys: json.keys });
  return 'on';
}

export function usePushNotifications() {
  const [state, setState] = useState<PushState>('off');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported()) { setState(isIos() && !standalone() ? 'ios-install' : 'unsupported'); return; }
    if (Notification.permission === 'denied') { setState('blocked'); return; }
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Must run from a click (browsers only ask for permission on a user gesture). */
  const enable = useCallback(async (): Promise<PushState> => {
    setBusy(true);
    try {
      // A failure or time-out ends as 'unavailable' (a message), never a stuck button.
      const s = await enablePush().catch((): PushState => 'unavailable');
      setState(s);
      return s;
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api.post('/notifications/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState('off');
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, enable, disable };
}
