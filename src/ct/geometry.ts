/**
 * CT Anatomy — geometry between DICOM patient coordinates (LPS, mm) and a series' pixels,
 * and the DICOM linear VOI LUT used for windowing.
 */
import type { SeriesMeta } from './data'

export type Plane = 'axial' | 'coronal' | 'sagittal'
export type Patient = [number, number, number] // x (→ patient left), y (→ posterior), z (→ superior), mm

export interface Geo {
  x0: number; y0: number
  colMm: number; rowMm: number
  z: Float64Array               // slice positions, ascending
  stepMm: number                // mean slice step
  cols: number; rows: number; count: number
}

export function geoOf(m: SeriesMeta): Geo {
  const iop = m.imageOrientationPatient.map((v) => Math.round(v * 1e4) / 1e4)
  if (iop.join() !== '1,0,0,0,1,0') throw new Error(`${m.series}: only axial (1,0,0,0,1,0) orientation is supported, got ${iop}`)
  const z = Float64Array.from(m.slices.map((s) => s.imagePositionPatient[2]))
  const [x0, y0] = m.slices[0].imagePositionPatient
  return {
    x0, y0, colMm: m.pixelSpacing[1], rowMm: m.pixelSpacing[0], z,
    stepMm: m.count > 1 ? (z[z.length - 1] - z[0]) / (m.count - 1) : m.sliceThickness,
    cols: m.columns, rows: m.rows, count: m.count,
  }
}

export function nearestSlice(g: Geo, zmm: number): number {
  let lo = 0, hi = g.count - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (g.z[mid] < zmm) lo = mid; else hi = mid }
  return Math.abs(g.z[lo] - zmm) <= Math.abs(g.z[hi] - zmm) ? lo : hi
}

export const colOf = (g: Geo, x: number) => Math.max(0, Math.min(g.cols - 1, Math.round((x - g.x0) / g.colMm)))
export const rowOf = (g: Geo, y: number) => Math.max(0, Math.min(g.rows - 1, Math.round((y - g.y0) / g.rowMm)))
export const xOf = (g: Geo, col: number) => g.x0 + col * g.colMm
export const yOf = (g: Geo, row: number) => g.y0 + row * g.rowMm

/** Size of the displayed image for a plane, in image pixels and mm per pixel. */
export function planeDims(g: Geo, plane: Plane) {
  if (plane === 'axial') return { w: g.cols, h: g.rows, pxW: g.colMm, pxH: g.rowMm }
  if (plane === 'coronal') return { w: g.cols, h: g.count, pxW: g.colMm, pxH: g.stepMm }
  return { w: g.rows, h: g.count, pxW: g.rowMm, pxH: g.stepMm }
}

/** Index of the slice shown in `plane` for a patient position. */
export function planeIndex(g: Geo, plane: Plane, p: Patient): number {
  return plane === 'axial' ? nearestSlice(g, p[2]) : plane === 'coronal' ? rowOf(g, p[1]) : colOf(g, p[0])
}
export function planeCount(g: Geo, plane: Plane) { return plane === 'axial' ? g.count : plane === 'coronal' ? g.rows : g.cols }

/** Image pixel (u = column on screen, v = row on screen) → patient position. */
export function toPatient(g: Geo, plane: Plane, index: number, u: number, v: number): Patient {
  if (plane === 'axial') return [xOf(g, u), yOf(g, v), g.z[index]]
  const k = Math.max(0, Math.min(g.count - 1, g.count - 1 - v)) // top row = most superior slice
  if (plane === 'coronal') return [xOf(g, u), yOf(g, index), g.z[k]]
  return [xOf(g, index), yOf(g, u), g.z[k]]
}

/** Patient position → image pixel (u, v) in a plane (may be fractional / outside). */
export function toImage(g: Geo, plane: Plane, p: Patient): [number, number] {
  const u = plane === 'sagittal' ? (p[1] - g.y0) / g.rowMm : (p[0] - g.x0) / g.colMm
  if (plane === 'axial') return [u, (p[1] - g.y0) / g.rowMm]
  return [u, g.count - 1 - (p[2] - g.z[0]) / g.stepMm]
}

/** Extract the stored values of one displayed image from the volume (coronal / sagittal). */
export function reformat<T extends Int16Array | Uint8Array>(vol: T, g: Geo, plane: 'coronal' | 'sagittal', index: number): T {
  const n = g.cols * g.rows
  const Ctor = vol.constructor as { new (len: number): T }
  if (plane === 'coronal') {
    const out = new Ctor(g.cols * g.count)
    for (let v = 0; v < g.count; v++) {
      const k = g.count - 1 - v
      out.set(vol.subarray(k * n + index * g.cols, k * n + (index + 1) * g.cols) as never, v * g.cols)
    }
    return out
  }
  const out = new Ctor(g.rows * g.count)
  for (let v = 0; v < g.count; v++) {
    const base = (g.count - 1 - v) * n + index
    for (let r = 0; r < g.rows; r++) out[v * g.rows + r] = vol[base + r * g.cols]
  }
  return out
}

/* ------------------------------------------------------------- VOI LUT */

/**
 * DICOM PS3.3 C.11.2.1.2.1 linear VOI function, applied to modality values
 * (HU = stored * slope + intercept). Returns an 8-bit display LUT indexed by
 * stored value (offset `min`); padding pixels map to black.
 */
export function makeLut(m: SeriesMeta, center: number, width: number): { lut: Uint8Array; min: number } {
  const min = m.pixelRepresentation === 1 ? -32768 : 0
  const max = m.pixelRepresentation === 1 ? 32767 : 65535
  const lo = Math.max(min, -4096), hi = Math.min(max, 8191) // stored range used by CT; beyond clamps
  const lut = new Uint8Array(hi - lo + 1)
  const w = Math.max(1, width), c = center
  const a = c - 0.5 - (w - 1) / 2, b = c - 0.5 + (w - 1) / 2
  for (let s = lo; s <= hi; s++) {
    const x = s * m.rescaleSlope + m.rescaleIntercept
    let y: number
    if (x <= a) y = 0
    else if (x > b) y = 255
    else y = ((x - (c - 0.5)) / (w - 1) + 0.5) * 255
    lut[s - lo] = Math.round(Math.max(0, Math.min(255, y)))
  }
  const pad = m.pixelPaddingValue - lo
  if (pad >= 0 && pad < lut.length) lut[pad] = 0
  return { lut, min: lo }
}

export const huOf = (m: SeriesMeta, stored: number) => stored * m.rescaleSlope + m.rescaleIntercept
