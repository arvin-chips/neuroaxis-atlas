/** CT Anatomy — case loading and slice geometry (see scripts/ct-anatomy/ctcase.py). */
import type { Plane } from './content'

export interface LabelDef { key: string; name: string; color: string; midline?: boolean }
export interface LevelAnchor { id: string; z: number; source?: string }
export interface Landmark { id: string; name: string; xyz: [number, number, number]; approx?: boolean }

export interface CaseMeta {
  id: string
  title: string
  summary?: string
  source: string
  sourceUrl?: string
  license: string
  termsUrl?: string
  credit?: string
  attribution?: string
  dims: [number, number, number]
  spacing: [number, number, number]
  originLps?: [number, number, number]
  intensity?: { calibrated: boolean; validRangeHU?: [number, number]; note?: string }
  limitations?: string[]
  segmentation?: { tool: string; tasks: string[]; note?: string } | null
  volume: { file: string; compression?: string }
  labels?: { file: string; compression?: string; table: Record<string, LabelDef> }
  levels: LevelAnchor[]
  landmarks: Landmark[]
}

export interface CaseIndexEntry { id: string; title: string; summary: string; hasLabels: boolean; huCalibrated: boolean }

export interface Volume {
  meta: CaseMeta
  nx: number; ny: number; nz: number
  sx: number; sy: number; sz: number
  hu: Int16Array
  labels: Uint8Array | null
  labelDefs: Map<number, LabelDef>
}

export const CASES_BASE = `${import.meta.env.BASE_URL}ct-cases/`

/**
 * Single-file offline build (npm run build:ct-offline): the case index, every
 * case.json and every binary (base64) are embedded in the HTML as
 * window.__CT_EMBED__, so the page needs no server and no network.
 */
interface Embed {
  index: CaseIndexEntry[]
  cases: Record<string, { meta: CaseMeta; files: Record<string, string> }>
}
const EMBED = (globalThis as unknown as { __CT_EMBED__?: Embed }).__CT_EMBED__
export const EMBEDDED = !!EMBED

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

async function fetchBinary(url: string, compression?: string): Promise<ArrayBuffer> {
  let raw: ArrayBuffer
  if (EMBED) {
    const m = url.slice(CASES_BASE.length).split('/')
    const b64 = EMBED.cases[m[0]]?.files[m[1]]
    if (!b64) throw new Error(`not embedded: ${url}`)
    raw = b64ToBuffer(b64)
  } else {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    raw = await res.arrayBuffer()
  }
  if (compression !== 'gzip') return raw
  const bytes = new Uint8Array(raw)
  // A server may already have stripped the gzip layer (Content-Encoding); detect the magic bytes.
  if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) return raw
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

export async function loadIndex(): Promise<CaseIndexEntry[]> {
  if (EMBED) return EMBED.index
  const res = await fetch(`${CASES_BASE}index.json`)
  if (!res.ok) throw new Error(`case index: HTTP ${res.status}`)
  return (await res.json()).cases as CaseIndexEntry[]
}

export function caseFiles(meta: CaseMeta): string[] {
  const base = `${CASES_BASE}${meta.id}/`
  return [`${base}case.json`, base + meta.volume.file, ...(meta.labels ? [base + meta.labels.file] : [])]
}

export async function loadCase(id: string): Promise<Volume> {
  const base = `${CASES_BASE}${id}/`
  let meta: CaseMeta
  if (EMBED) {
    if (!EMBED.cases[id]) throw new Error(`case ${id} not embedded`)
    meta = EMBED.cases[id].meta
  } else {
    const res = await fetch(`${base}case.json`)
    if (!res.ok) throw new Error(`case ${id}: HTTP ${res.status}`)
    meta = (await res.json()) as CaseMeta
  }
  const [nx, ny, nz] = meta.dims
  const [sx, sy, sz] = meta.spacing
  const huBuf = await fetchBinary(base + meta.volume.file, meta.volume.compression)
  const hu = new Int16Array(huBuf)
  if (hu.length !== nx * ny * nz) throw new Error(`volume size ${hu.length} ≠ ${nx}×${ny}×${nz}`)
  let labels: Uint8Array | null = null
  const labelDefs = new Map<number, LabelDef>()
  if (meta.labels) {
    labels = new Uint8Array(await fetchBinary(base + meta.labels.file, meta.labels.compression))
    if (labels.length !== hu.length) throw new Error('label map size mismatch')
    for (const [k, v] of Object.entries(meta.labels.table)) labelDefs.set(Number(k), v)
  }
  return { meta, nx, ny, nz, sx, sy, sz, hu, labels, labelDefs }
}

/* ------------------------------------------------------------ geometry */

export type Voxel = [number, number, number]

export interface PlaneGeom {
  w: number; h: number          // slice pixel dims (cols, rows)
  colMm: number; rowMm: number  // physical size of one pixel
  count: number                 // number of slices along the normal
}

export function planeGeom(v: Volume, plane: Plane): PlaneGeom {
  if (plane === 'axial') return { w: v.nx, h: v.ny, colMm: v.sx, rowMm: v.sy, count: v.nz }
  if (plane === 'coronal') return { w: v.nx, h: v.nz, colMm: v.sx, rowMm: v.sz, count: v.ny }
  return { w: v.ny, h: v.nz, colMm: v.sy, rowMm: v.sz, count: v.nx }
}

/** Slice index of a voxel cursor for a plane. */
export function sliceOf(plane: Plane, c: Voxel): number {
  return plane === 'axial' ? c[2] : plane === 'coronal' ? c[1] : c[0]
}

/**
 * (col,row) in a slice → voxel. Display conventions:
 *  axial:    col = x (patient right on screen left), row = y (anterior at top)
 *  coronal:  col = x, row = superior at top
 *  sagittal: col = y (anterior on screen left), row = superior at top
 */
export function toVoxel(v: Volume, plane: Plane, slice: number, col: number, row: number): Voxel {
  if (plane === 'axial') return [col, row, slice]
  if (plane === 'coronal') return [col, slice, v.nz - 1 - row]
  return [slice, col, v.nz - 1 - row]
}

export function toColRow(v: Volume, plane: Plane, c: Voxel): [number, number] {
  if (plane === 'axial') return [c[0], c[1]]
  if (plane === 'coronal') return [c[0], v.nz - 1 - c[2]]
  return [c[1], v.nz - 1 - c[2]]
}

export function voxelIndex(v: Volume, x: number, y: number, z: number): number {
  return (z * v.ny + y) * v.nx + x
}

export function clampVoxel(v: Volume, c: Voxel): Voxel {
  return [
    Math.max(0, Math.min(v.nx - 1, Math.round(c[0]))),
    Math.max(0, Math.min(v.ny - 1, Math.round(c[1]))),
    Math.max(0, Math.min(v.nz - 1, Math.round(c[2]))),
  ]
}

export interface SliceData { w: number; h: number; hu: Int16Array; lab: Uint8Array | null }

export function extractSlice(v: Volume, plane: Plane, slice: number): SliceData {
  const g = planeGeom(v, plane)
  const s = Math.max(0, Math.min(g.count - 1, slice))
  const hu = new Int16Array(g.w * g.h)
  const lab = v.labels ? new Uint8Array(g.w * g.h) : null
  const { nx, ny, nz } = v
  if (plane === 'axial') {
    const off = s * nx * ny
    hu.set(v.hu.subarray(off, off + nx * ny))
    if (lab && v.labels) lab.set(v.labels.subarray(off, off + nx * ny))
  } else {
    for (let row = 0; row < g.h; row++) {
      const z = nz - 1 - row
      for (let col = 0; col < g.w; col++) {
        const i = plane === 'coronal' ? (z * ny + s) * nx + col : (z * ny + col) * nx + s
        hu[row * g.w + col] = v.hu[i]
        if (lab && v.labels) lab[row * g.w + col] = v.labels[i]
      }
    }
  }
  return { w: g.w, h: g.h, hu, lab }
}

/** Level anchors sorted by z, and the nearest one to an axial slice. */
export function nearestLevel(levels: LevelAnchor[], z: number): { anchor: LevelAnchor; dz: number } | null {
  let best: LevelAnchor | null = null
  for (const l of levels) if (!best || Math.abs(l.z - z) < Math.abs(best.z - z)) best = l
  return best ? { anchor: best, dz: z - best.z } : null
}

export function labelKey(v: Volume, value: number): string | null {
  return v.labelDefs.get(value)?.key ?? null
}

export function labelValueByKey(v: Volume, key: string): number | null {
  for (const [k, d] of v.labelDefs) if (d.key === key) return k
  return null
}
