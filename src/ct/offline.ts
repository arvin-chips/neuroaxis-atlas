/**
 * CT Anatomy — offline support for a hosted copy (https or localhost).
 *
 * `public/ct-sw.js` answers same-origin GETs from the network and falls back to
 * Cache Storage. "Save for offline" stores the app files and every data file
 * (index, series.json, annotations, all chunks) in that cache, so after one
 * online visit the app works with no connection. Nothing is cached implicitly.
 */
import { DATA_BASE, type DataIndex, type SeriesMeta } from './data'

export const CACHE = 'ct-anatomy-v2' // keep in sync with public/ct-sw.js

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}ct-sw.js`, { scope: import.meta.env.BASE_URL })
    .catch((e) => console.warn('[ct-anatomy] service worker not registered:', e))
}

function appFiles(): string[] {
  const urls = new Set<string>([location.pathname])
  for (const e of performance.getEntriesByType('resource')) {
    const u = new URL(e.name)
    if (u.origin === location.origin && !u.pathname.includes('/ct-data/')) urls.add(u.pathname)
  }
  return [...urls]
}

export async function dataFiles(index: DataIndex, metas: SeriesMeta[]): Promise<{ url: string; bytes: number }[]> {
  const out = [{ url: `${DATA_BASE}index.json`, bytes: 0 }]
  for (const e of index.exams) out.push({ url: `${DATA_BASE}${e.id}/annotations.json`, bytes: 0 })
  for (const m of metas) {
    out.push({ url: `${DATA_BASE}${m.study}/${m.series}/series.json`, bytes: 0 })
    for (const c of m.chunks) out.push({ url: `${DATA_BASE}${m.study}/${m.series}/${c.file}`, bytes: c.bytes })
  }
  return out
}

export async function saveOffline(index: DataIndex, metas: SeriesMeta[], onProgress: (doneBytes: number, totalBytes: number, files: number) => void): Promise<number> {
  if (!('caches' in window)) throw new Error('This browser has no Cache Storage. Use https or localhost.')
  const cache = await caches.open(CACHE)
  const files = [...appFiles().map((url) => ({ url, bytes: 0 })), ...(await dataFiles(index, metas))]
  const total = files.reduce((s, f) => s + f.bytes, 0)
  let done = 0, n = 0
  for (const f of files) {
    if (!(await cache.match(f.url))) {
      const res = await fetch(f.url, { cache: 'reload' })
      if (!res.ok) throw new Error(`${f.url}: HTTP ${res.status}`)
      await cache.put(f.url, res)
    }
    done += f.bytes; n++
    onProgress(done, total, n)
  }
  return n
}

export async function offlineStatus(index: DataIndex | null, metas: SeriesMeta[]): Promise<{ cached: number; total: number }> {
  if (!('caches' in window) || !index) return { cached: 0, total: 0 }
  const cache = await caches.open(CACHE)
  const files = await dataFiles(index, metas)
  let cached = 0
  for (const f of files) if (await cache.match(f.url)) cached++
  return { cached, total: files.length }
}
