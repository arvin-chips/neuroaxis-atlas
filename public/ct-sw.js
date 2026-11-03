/* CT Anatomy offline service worker: network-first, cache fallback.
   Only answers from the cache that the page fills explicitly ("Save offline"). */
const CACHE = 'ct-anatomy-v1'  // keep in sync with src/ct/offline.ts
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  e.respondWith(
    fetch(req).catch(async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true })
      if (hit) return hit
      throw new Error('offline and not cached: ' + req.url)
    }),
  )
})
