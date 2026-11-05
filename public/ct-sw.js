/* CT Anatomy offline service worker.
   - Image data (/ct-data/...) is immutable: answered from the cache when saved, else network.
   - Everything else: network first, cache fallback (so app updates arrive when online).
   Only files the page saved explicitly ("Save for offline") are in the cache. */
const CACHE = 'ct-anatomy-v2'  // keep in sync with src/ct/offline.ts
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return
  const fromCache = async () => (await caches.open(CACHE)).match(req, { ignoreSearch: true, ignoreVary: true })
  if (url.pathname.includes('/ct-data/')) {
    e.respondWith(fromCache().then((hit) => hit || fetch(req)))
    return
  }
  e.respondWith(fetch(req).catch(async () => {
    const hit = await fromCache()
    if (hit) return hit
    throw new Error('offline and not cached: ' + req.url)
  }))
})
