import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { api } from '@/lib/api';

// Android app notifications via Firebase Cloud Messaging
// (build-docs/features/android-push.md). Web push doesn't work inside the
// app's WebView, so the app registers its own FCM token after sign-in.
// Tapping a notification opens the page it is about.

/** App-relative path from a notification's url, or null for anything else. */
export function appPathFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith('/app/') || url.includes('//')) return null;
  return url;
}

export function useNativePush(userId: string | undefined): void {
  const navigate = useNavigate();

  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    void (async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const reg = await PushNotifications.addListener('registration', (t) => {
          void api.post('/notifications/push/native', { token: t.value }).catch(() => undefined);
        });
        const tap = await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
          const path = appPathFromUrl(a.notification.data?.url);
          if (path) navigate(path);
        });
        cleanups.push(() => void reg.remove(), () => void tap.remove());
        if (cancelled) return;
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
        if (perm.receive === 'granted' && !cancelled) await PushNotifications.register();
      } catch {
        // No Firebase config in this build, or the plugin is missing: the bell still works.
      }
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((c) => c());
    };
  }, [userId, navigate]);
}
