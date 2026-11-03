/**
 * CT Anatomy — offline support.
 *
 * `public/ct-sw.js` serves same-origin GETs network-first and falls back to the
 * Cache Storage, so once "Save offline" has stored the page, its scripts/styles
 * and every case file, the module works with no connection. Saving is explicit
 * (scan volumes are several MB each). For a fully local install without a
 * browser cache, `npm run build` and serve dist/ — see docs/CT_ANATOMY.md.
 */
import { caseFiles, CASES_BASE, type CaseMeta } from './volume'

export const CACHE = 'ct-anatomy-v1'

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}ct-sw.js`, { scope: import.meta.env.BASE_URL })
    .catch((e) => console.warn('[ct-anatomy] service worker not registered:', e))
}

function pageAssets(): string[] {
  const urls = new Set<string>([location.pathname])
  for (const e of performance.getEntriesByType('resource')) {
    const u = new URL(e.name)
    if (u.origin === location.origin && !u.pathname.includes('/ct-cases/')) urls.add(u.pathname)
  }
  return [...urls]
}

export async function saveOffline(cases: CaseMeta[], onProgress: (done: number, total: number) => void): Promise<number> {
  if (!('caches' in window)) throw new Error('This browser has no Cache Storage (try a secure http(s) origin).')
  const cache = await caches.open(CACHE)
  const urls = [...pageAssets(), `${CASES_BASE}index.json`, ...cases.flatMap(caseFiles)]
  let done = 0
  for (const u of urls) {
    const res = await fetch(u, { cache: 'reload' })
    if (res.ok) await cache.put(u, res)
    onProgress(++done, urls.length)
  }
  return urls.length
}

export async function offlineStatus(): Promise<number> {
  if (!('caches' in window)) return 0
  const cache = await caches.open(CACHE)
  return (await cache.keys()).length
}
