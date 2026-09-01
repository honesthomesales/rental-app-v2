// Service Worker for Rental Management App PWA
const CACHE_NAME = 'rental-app-v2-2026-09-01-profit-recovery';

// Install: activate immediately; do not pre-cache app shells (stale auth bundles).
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

// Only intercept navigations for offline fallback. Never touch APIs or JS bundles.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;
  if (
    url.includes('/api/') ||
    url.includes('/_next/') ||
    url.includes('/auth/')
  ) {
    return;
  }

  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.open(CACHE_NAME);
      return (
        (await cached.match(event.request)) ||
        (await cached.match('/')) ||
        new Response('Offline', { status: 503 })
      );
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
            return undefined;
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
