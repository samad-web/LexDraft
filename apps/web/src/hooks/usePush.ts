import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

// web-push (owner 2026-11-19): show DifAi notifications in the phone /
// computer notification bar. Android Chrome and desktop browsers work in the
// browser; iPhone only after "Add to Home Screen" (iOS 16.4+).

export type PushState = 'unsupported' | 'ios-install' | 'off' | 'on' | 'blocked' | 'unavailable';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

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
      const { publicKey } = await api.get<{ publicKey: string | null }>('/notifications/push/key');
      if (!publicKey) { setState('unavailable'); return 'unavailable'; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { const s: PushState = perm === 'denied' ? 'blocked' : 'off'; setState(s); return s; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription())
        ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api.post('/notifications/push/subscription', { endpoint: json.endpoint, keys: json.keys });
      setState('on');
      return 'on';
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
