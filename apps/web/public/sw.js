/* DifAi service worker — phone/computer notifications only (web-push.md).
   No caching and no offline logic: the app itself is always loaded fresh. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { title: 'DifAi', body: event.data ? event.data.text() : '' }; }
  const url = typeof data.url === 'string' && data.url.startsWith('/app/') ? data.url : '/app/dashboard';
  event.waitUntil(self.registration.showNotification(data.title || 'DifAi', {
    body: data.body || '',
    icon: '/apple-touch-icon.png',
    badge: '/favicon-32.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/app/dashboard';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if ('navigate' in c) return c.navigate(url);
        return undefined;
      }
    }
    return self.clients.openWindow(url);
  })());
});
