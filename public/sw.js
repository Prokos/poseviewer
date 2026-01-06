const VERSION = 'v1';
const THUMB_CACHE = `poseviewer-thumbs-${VERSION}`;
const MEDIA_CACHE = `poseviewer-media-${VERSION}`;

const MAX_THUMB_ENTRIES = 500;
const MAX_MEDIA_ENTRIES = 200;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const keep = new Set([THUMB_CACHE, MEDIA_CACHE]);
      await Promise.all(keys.map((key) => (keep.has(key) ? null : caches.delete(key))));
      await self.clients.claim();
    })()
  );
});

async function enforceLimit(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) {
    return;
  }
  const overflow = keys.length - maxEntries;
  for (let i = 0; i < overflow; i += 1) {
    await cache.delete(keys[i]);
  }
}

async function cacheResponse(cacheName, request, response) {
  if (!response || response.status !== 200) {
    return response;
  }
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith('/api/thumb/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(THUMB_CACHE);
        const cached = await cache.match(request);
        if (cached) {
          event.waitUntil(
            fetch(request)
              .then((response) => cacheResponse(THUMB_CACHE, request, response))
              .then(() => enforceLimit(THUMB_CACHE, MAX_THUMB_ENTRIES))
              .catch(() => null)
          );
          return cached;
        }
        const response = await fetch(request);
        await cacheResponse(THUMB_CACHE, request, response);
        await enforceLimit(THUMB_CACHE, MAX_THUMB_ENTRIES);
        return response;
      })()
    );
    return;
  }

  if (url.pathname.startsWith('/api/media/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MEDIA_CACHE);
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }
        const response = await fetch(request);
        await cacheResponse(MEDIA_CACHE, request, response);
        await enforceLimit(MEDIA_CACHE, MAX_MEDIA_ENTRIES);
        return response;
      })()
    );
  }
});
