const CACHE_NAME = 'umuo-v1';
const PRECACHE_URLS = ['/', '/index.html'];

// Install: precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

// Fetch strategy:
//  - HTML navigations: network-first, so a new deploy's index.html (with fresh
//    asset hashes) always wins. Stale-cached HTML pointing at deleted hashed
//    bundles is what causes the "MIME type text/html" module-load failure.
//    Falls back to cache only when offline.
//  - Static assets: cache-first (Vite hashes are immutable).
// `event.waitUntil` is only ever called while `respondWith` is still pending,
// so the event lifetime is genuinely extended — calling it from a detached
// background promise throws InvalidStateError. `.catch` swallows
// QuotaExceededError so one bad write can't poison the response.
function cachePut(event, response) {
  if (!response.ok) return;
  const clone = response.clone();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.put(event.request, clone))
      .catch(() => {}),
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // let cross-origin requests pass through
  if (url.pathname.startsWith('/api/')) return; // never cache API responses

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          cachePut(event, response);
          return response;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match('/index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        cachePut(event, response);
        return response;
      });
    }),
  );
});
