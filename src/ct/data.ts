/**
 * CT Anatomy — image data access (ct-anatomy-data repository format).
 *
 * The image data is NOT part of this source repository. It lives in a separate
 * data repository whose viewer/ folder is served next to the app (default
 * `<base>/ct-data/`, or `?data=<url>`):
 *
 *   index.json                                exams and their series
 *   <study>/annotations.json                  levels + landmarks (separate overlay layer)
 *   <study>/<series>/series.json              DICOM geometry, rescale, per-slice index
 *   <study>/<series>/chunks/cNNN.bin          consecutive slices, each: raw DEFLATE of the
 *                                             stored int16 values after a byte-plane shuffle
 *
 * Pixel values are the original DICOM stored values; HU = stored * slope + intercept.
 * Nothing here filters, resamples or windows the data.
 */
import { inflateSync } from 'fflate'

export const DATA_BASE = (() => {
  const q = new URLSearchParams(location.search).get('data')
  const b = q ?? `${import.meta.env.BASE_URL}ct-data/`
  return b.endsWith('/') ? b : `${b}/`
})()

export interface ExamInfo {
  id: string
  patientLabel: string
  title: string
  purpose: string
  series: string[]
}
export interface DataIndex { exams: ExamInfo[]; source: string; license: string; licenseUrl?: string }

export interface SliceInfo {
  i: number
  chunk: number
  offset: number
  length: number
  sourceFile: string
  imagePositionPatient: [number, number, number]
  sha256StoredInt16LE: string
}
export interface SeriesMeta {
  study: string
  series: string
  sourceSeriesDescription: string
  role: string
  rows: number
  columns: number
  pixelSpacing: [number, number] // [row spacing, column spacing] (DICOM order)
  sliceThickness: number
  imageOrientationPatient: number[]
  bitsStored: number
  pixelRepresentation: number
  rescaleSlope: number
  rescaleIntercept: number
  pixelPaddingValue: number
  convolutionKernel: string
  kvp: number
  tubeCurrent_mA: number
  dicomWindowCenter: number | number[] | null
  dicomWindowWidth: number | number[] | null
  count: number
  compressedBytes: number
  chunks: { file: string; bytes: number; sha256: string }[]
  slices: SliceInfo[]
  license: string
  source: string
}

export interface Landmark { id: string; name: string; p: [number, number, number]; approx?: boolean }
export interface LevelAnchor { id: string; z: number }
export interface Annotations { study: string; method: string; levels: LevelAnchor[]; landmarks: Landmark[] }

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r.json() as Promise<T>
}

export const loadIndex = () => getJson<DataIndex>(`${DATA_BASE}index.json`)
export const loadSeriesMeta = (study: string, series: string) => getJson<SeriesMeta>(`${DATA_BASE}${study}/${series}/series.json`)
export const loadAnnotations = (study: string) => getJson<Annotations>(`${DATA_BASE}${study}/annotations.json`)

/* ----------------------------------------------------------------- decode */

const hasNativeInflate = (() => {
  try { new DecompressionStream('deflate-raw'); return true } catch { return false }
})()

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (hasNativeInflate) {
    const ds = new DecompressionStream('deflate-raw')
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer()
    return new Uint8Array(await out)
  }
  return inflateSync(bytes)
}

/** Undo the byte-plane shuffle: first n bytes are low bytes, next n are high bytes. */
function unshuffle(raw: Uint8Array, n: number, out: Int16Array) {
  if (raw.length !== 2 * n) throw new Error(`slice length ${raw.length} ≠ ${2 * n}`)
  for (let i = 0; i < n; i++) {
    const v = raw[i] | (raw[n + i] << 8)
    out[i] = v > 32767 ? v - 65536 : v
  }
}

/* ------------------------------------------------------------- the store */

export interface StoreStats {
  decodedSlices: number      // slices currently held decoded in memory
  cachedChunks: number
  bytesFetched: number
  decodeMsTotal: number
  decodeCount: number
  volumeLoaded: boolean
  volumeBytes: number
}

/**
 * Progressive slice access for one series.
 * - Only requested slices (plus a small neighbourhood) are decoded; they live in an LRU.
 * - A full volume (needed for coronal/sagittal) is built only on request, and released by dispose().
 */
export class SeriesStore {
  readonly meta: SeriesMeta
  readonly n: number
  private chunkCache = new Map<number, Promise<Uint8Array>>()
  private chunkOrder: number[] = []
  private lru = new Map<number, Int16Array>()
  private pending = new Map<number, Promise<Int16Array>>()
  private volume: Int16Array | null = null
  private volumeReady = new Set<number>()
  private listeners = new Set<() => void>()
  private disposed = false
  stats: StoreStats = { decodedSlices: 0, cachedChunks: 0, bytesFetched: 0, decodeMsTotal: 0, decodeCount: 0, volumeLoaded: false, volumeBytes: 0 }
  constructor(meta: SeriesMeta, private maxSlices = 40, private maxChunks = 4) {
    this.meta = meta
    this.n = meta.rows * meta.columns
  }

  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private emit() { for (const f of this.listeners) f() }

  dispose() {
    this.disposed = true
    this.lru.clear(); this.chunkCache.clear(); this.chunkOrder = []; this.pending.clear()
    this.volume = null; this.volumeReady.clear(); this.listeners.clear()
    this.stats.volumeLoaded = false; this.stats.volumeBytes = 0; this.stats.decodedSlices = 0
  }

  private chunk(c: number): Promise<Uint8Array> {
    let p = this.chunkCache.get(c)
    if (!p) {
      const info = this.meta.chunks[c]
      p = fetch(`${DATA_BASE}${this.meta.study}/${this.meta.series}/${info.file}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`${info.file}: HTTP ${r.status}`)
          // Hosts that cannot serve binary files get the same bytes as base64 text (*.b64.txt).
          if (info.file.endsWith('.b64.txt')) {
            const t = await r.text(); const bin = atob(t.trim()); const u = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
            return u.buffer
          }
          return r.arrayBuffer()
        })
        .then((b) => {
          if (b.byteLength !== info.bytes) throw new Error(`${info.file}: ${b.byteLength} bytes, expected ${info.bytes}`)
          this.stats.bytesFetched += b.byteLength
          return new Uint8Array(b)
        })
      p.catch(() => this.chunkCache.delete(c))
      this.chunkCache.set(c, p)
      this.chunkOrder.push(c)
      while (this.chunkOrder.length > this.maxChunks) this.chunkCache.delete(this.chunkOrder.shift()!)
      this.stats.cachedChunks = this.chunkCache.size
    }
    return p
  }

  /** Synchronous access: returns the slice if decoded (or in the volume), else null. */
  peek(i: number): Int16Array | null {
    if (this.volume && this.volumeReady.has(i)) return this.volume.subarray(i * this.n, (i + 1) * this.n)
    const s = this.lru.get(i)
    if (s) { this.lru.delete(i); this.lru.set(i, s) }
    return s ?? null
  }

  private async decode(i: number): Promise<Int16Array> {
    const s = this.meta.slices[i]
    const bytes = await this.chunk(s.chunk)
    const t0 = performance.now()
    const raw = await inflateRaw(bytes.subarray(s.offset, s.offset + s.length))
    const out = new Int16Array(this.n)
    unshuffle(raw, this.n, out)
    this.stats.decodeMsTotal += performance.now() - t0
    this.stats.decodeCount++
    return out
  }

  /** Decode slice i (if needed) into the LRU. Resolves when available. */
  get(i: number): Promise<Int16Array> {
    const have = this.peek(i)
    if (have) return Promise.resolve(have)
    let p = this.pending.get(i)
    if (!p) {
      p = this.decode(i).then((arr) => {
        this.pending.delete(i)
        if (this.disposed) return arr
        if (this.volume) { this.volume.set(arr, i * this.n); this.volumeReady.add(i) }
        else {
          this.lru.set(i, arr)
          while (this.lru.size > this.maxSlices) this.lru.delete(this.lru.keys().next().value as number)
        }
        this.stats.decodedSlices = this.volume ? this.volumeReady.size : this.lru.size
        this.emit()
        return arr
      }, (e) => { this.pending.delete(i); throw e })
      this.pending.set(i, p)
    }
    return p
  }

  /** Request slice i and prefetch neighbours (nearest first). */
  request(i: number, radius = 6) {
    void this.get(i).catch((e) => console.error(e))
    for (let d = 1; d <= radius; d++) {
      for (const j of [i + d, i - d]) if (j >= 0 && j < this.meta.count && !this.peek(j)) void this.get(j).catch(() => {})
    }
  }

  get hasVolume() { return !!this.volume && this.volumeReady.size === this.meta.count }

  /** Decode every slice into one contiguous volume (for multiplanar views). */
  async loadVolume(onProgress: (done: number, total: number) => void): Promise<Int16Array> {
    if (this.hasVolume) return this.volume!
    if (!this.volume) {
      this.volume = new Int16Array(this.n * this.meta.count)
      this.stats.volumeBytes = this.volume.byteLength
      for (const [i, s] of this.lru) { this.volume.set(s, i * this.n); this.volumeReady.add(i) }
      this.lru.clear()
    }
    const total = this.meta.count
    // chunk by chunk so each 3 MB chunk is fetched once and can then be dropped
    const byChunk = new Map<number, number[]>()
    for (const s of this.meta.slices) if (!this.volumeReady.has(s.i)) (byChunk.get(s.chunk) ?? byChunk.set(s.chunk, []).get(s.chunk)!).push(s.i)
    for (const [, list] of byChunk) {
      if (this.disposed) break
      await Promise.all(list.map((i) => this.get(i)))
      onProgress(this.volumeReady.size, total)
    }
    this.stats.volumeLoaded = this.volumeReady.size === total
    this.emit()
    return this.volume
  }

  /** Release the full volume and go back to the small LRU. */
  dropVolume() {
    this.volume = null; this.volumeReady.clear()
    this.stats.volumeLoaded = false; this.stats.volumeBytes = 0; this.stats.decodedSlices = this.lru.size
    this.emit()
  }
  get volumeData() { return this.hasVolume ? this.volume : null }
}

/* ------------------------------------------------------- label layer */

export interface LabelDef { id: number; task: string; source: string; name: string; group: string; color: string; teach: string | null; voxels: number; volume_ml: number }
export interface LabelMeta {
  study: string
  series: string
  rows: number
  columns: number
  count: number
  labels: LabelDef[]
  chunks: { file: string; bytes: number; sha256: string }[]
  slices: { i: number; chunk: number; offset: number; length: number; present: number[]; sha256: string }[]
  tool: string
  tasks: string[]
  note: string
}

/** Segmentation labels for a series, or null when none were produced. */
export async function loadLabelMeta(study: string, series: string): Promise<LabelMeta | null> {
  const r = await fetch(`${DATA_BASE}${study}/${series}/labels/labels.json`)
  if (!r.ok) return null
  // some static hosts answer a missing file with an HTML page and status 200
  try { const m = JSON.parse(await r.text()) as LabelMeta; return Array.isArray(m?.labels) ? m : null } catch { return null }
}

async function fetchChunkBytes(url: string, file: string, expected: number): Promise<Uint8Array> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`)
  let b: ArrayBuffer
  if (file.endsWith('.b64.txt')) {
    const bin = atob((await r.text()).trim()); const u = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
    b = u.buffer
  } else b = await r.arrayBuffer()
  if (b.byteLength !== expected) throw new Error(`${file}: ${b.byteLength} bytes, expected ${expected}`)
  return new Uint8Array(b)
}

/**
 * Label slices (uint8, same grid as the CT series), decoded on demand. Stored and drawn
 * separately from the CT pixels; never combined with them.
 */
export class LabelStore {
  readonly meta: LabelMeta
  readonly n: number
  private chunks = new Map<number, Promise<Uint8Array>>()
  private lru = new Map<number, Uint8Array>()
  private pending = new Map<number, Promise<Uint8Array>>()
  private volume: Uint8Array | null = null
  private ready = new Set<number>()
  private listeners = new Set<() => void>()
  private disposed = false
  constructor(meta: LabelMeta, private maxSlices = 48) { this.meta = meta; this.n = meta.rows * meta.columns }
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private emit() { for (const f of this.listeners) f() }
  dispose() { this.disposed = true; this.lru.clear(); this.chunks.clear(); this.pending.clear(); this.volume = null; this.ready.clear(); this.listeners.clear() }

  private chunk(c: number) {
    let p = this.chunks.get(c)
    if (!p) {
      const info = this.meta.chunks[c]
      p = fetchChunkBytes(`${DATA_BASE}${this.meta.study}/${this.meta.series}/${info.file}`, info.file, info.bytes)
      p.catch(() => this.chunks.delete(c))
      this.chunks.set(c, p)
      if (this.chunks.size > 6) this.chunks.delete(this.chunks.keys().next().value as number)
    }
    return p
  }
  peek(i: number): Uint8Array | null {
    if (this.volume && this.ready.has(i)) return this.volume.subarray(i * this.n, (i + 1) * this.n)
    return this.lru.get(i) ?? null
  }
  get(i: number): Promise<Uint8Array> {
    const have = this.peek(i)
    if (have) return Promise.resolve(have)
    let p = this.pending.get(i)
    if (!p) {
      const s = this.meta.slices[i]
      p = this.chunk(s.chunk).then((b) => inflateRaw(b.subarray(s.offset, s.offset + s.length))).then((raw) => {
        if (raw.length !== this.n) throw new Error(`label slice ${i}: ${raw.length} ≠ ${this.n}`)
        this.pending.delete(i)
        if (!this.disposed) {
          if (this.volume) { this.volume.set(raw, i * this.n); this.ready.add(i) }
          else { this.lru.set(i, raw); while (this.lru.size > this.maxSlices) this.lru.delete(this.lru.keys().next().value as number) }
          this.emit()
        }
        return raw
      }, (e) => { this.pending.delete(i); throw e })
      this.pending.set(i, p)
    }
    return p
  }
  request(i: number, radius = 4) {
    void this.get(i).catch((e) => console.error(e))
    for (let d = 1; d <= radius; d++) for (const j of [i + d, i - d]) if (j >= 0 && j < this.meta.count && !this.peek(j)) void this.get(j).catch(() => {})
  }
  get hasVolume() { return !!this.volume && this.ready.size === this.meta.count }
  get volumeData() { return this.hasVolume ? this.volume : null }
  async loadVolume(): Promise<void> {
    if (this.hasVolume) return
    if (!this.volume) {
      this.volume = new Uint8Array(this.n * this.meta.count)
      for (const [i, s] of this.lru) { this.volume.set(s, i * this.n); this.ready.add(i) }
      this.lru.clear()
    }
    for (let i = 0; i < this.meta.count; i++) if (!this.ready.has(i)) await this.get(i)
    this.emit()
  }
  dropVolume() { this.volume = null; this.ready.clear(); this.emit() }
}
