/// <reference lib="webworker" />

import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<unknown>;
};

type PushNotificationPayload = NotificationOptions & {
  title?: string;
  renotify?: boolean;
};

self.skipWaiting();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'pages',
    networkTimeoutSeconds: 4,
  }),
);

registerRoute(
  ({ request }) => ['script', 'style', 'image', 'font'].includes(request.destination),
  new StaleWhileRevalidate({ cacheName: 'assets' }),
);

self.addEventListener('push', (event) => {
  const payload = event.data?.json() as PushNotificationPayload | undefined;
  const title = payload?.title ?? 'Mocha Med Log';
  const options = {
    body: payload?.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload?.tag,
    renotify: payload?.renotify,
    requireInteraction: payload?.requireInteraction,
    data: { url: (payload as { url?: string } | undefined)?.url ?? '/' },
  } as NotificationOptions;

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = String((event.notification.data as { url?: string } | undefined)?.url ?? '/');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      return self.clients.openWindow(targetUrl);
    }),
  );
});
