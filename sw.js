const CACHE_NAME = 'job-tracker-v1';

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
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // cache-first strategy for GET requests
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});