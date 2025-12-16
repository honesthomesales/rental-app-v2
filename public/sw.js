// Service Worker for Rental Management App PWA
const CACHE_NAME = 'rental-app-v2';
const urlsToCache = [
  '/',
  '/payments',
  '/properties',
  '/leases',
  '/tenants',
  '/late-tenants',
  '/profit',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  // Skip caching for API routes and non-GET requests
  if (event.request.url.includes('/api/') || event.request.method !== 'GET') {
    event.respondWith(fetch(event.request).catch(() => {
      // Return a basic error response for API failures
      return new Response(JSON.stringify({ error: 'Network error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }));
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        if (response) {
          return response;
        }
        return fetch(event.request).then((fetchResponse) => {
          // Only cache successful responses
          if (fetchResponse && fetchResponse.status === 200) {
            const responseToCache = fetchResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return fetchResponse;
        }).catch((error) => {
          console.error('Fetch failed:', error);
          // Return a basic error page for navigation failures
          if (event.request.mode === 'navigate') {
            return caches.match('/') || new Response('Offline', { status: 503 });
          }
          throw error;
        });
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
