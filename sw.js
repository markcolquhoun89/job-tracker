const CACHE_NAME = 'job-tracker-v2';

// simple offline caching of shell assets;
// update list when you add new build outputs
const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/js/bridge.js',
  '/js/state.js',
  '/js/database.js',
  '/js/jobs.js',
  '/js/modals.js',
  '/js/utils.js',
  '/js/calculations.js',
  '/js/supabase-client.js',
  '/js/sync.js',
  '/js/constants.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isAppShell =
    event.request.mode === 'navigate' ||
    event.request.destination === 'script' ||
    event.request.destination === 'style';

  if (isSameOrigin && isAppShell) {
    // Network-first for app code to avoid stale bundles causing old runtime bugs.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(event.request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        throw new Error('Offline and no cached shell asset available');
      }
    })());
    return;
  }

  // Cache-first for non-critical/static assets.
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (isSameOrigin) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(event.request, response.clone());
    }
    return response;
  })());
});