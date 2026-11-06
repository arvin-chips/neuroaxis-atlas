import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LabelDef, LabelStore, Landmark, LevelAnchor, SeriesStore } from './data'
import {
  huOf, makeLut, planeCount, planeDims, planeIndex, reformat, toImage, toPatient,
  type Geo, type Patient, type Plane,
} from './geometry'
import { LEVELS } from './content'

export type Zoom = 'fit' | number // number = image pixels per CSS pixel along the column axis (1 = 100 %)

export interface Hover { p: Patient; stored: number; hu: number | null; landmark: Landmark | null; label: LabelDef | null }

/** How the segmentation layer is shown (it is drawn on its own canvas, never into the CT pixels). */
export interface SegView {
  show: boolean
  opacity: number
  outline: boolean
  text: boolean
  hidden: Set<number>
  isolate: number | null
  emphasis: Set<number>            // when non-empty, only these labels are coloured
  quizOutline?: number | null      // quiz: outline only this label, no names
  defs: Map<number, LabelDef>
}
export interface Measure { plane: Plane; index: number; a: [number, number]; b: [number, number] }

interface Props {
  store: SeriesStore
  geo: Geo
  plane: Plane
  cursor: Patient
  onCursor: (p: Patient) => void
  center: number
  width: number
  onWindow?: (c: number, w: number) => void
  zoom: Zoom
  onZoom?: (z: Zoom) => void
  volumeReady: boolean // the store holds the full volume (coronal/sagittal)
  landmarks: Landmark[]
  levels: LevelAnchor[]
  showLandmarks: boolean
  showLabels: boolean
  showCrosshair: boolean
  highlight?: Set<string>
  accent: string
  compact?: boolean
  measureMode?: boolean
  measure?: Measure | null
  onMeasure?: (m: Measure | null) => void
  onHover?: (h: Hover | null) => void
  onPick?: (h: Hover) => void
  onActivate?: () => void
  version: number // bump to redraw when the store decodes new slices
  labels?: LabelStore | null
  seg?: SegView
  mipMm?: number // axial thick-slab maximum-intensity projection (display only), 0 = off
  examLabel?: string
}

const PAIRED = new Set(['caudate_nucleus', 'lentiform_nucleus', 'thalamus', 'internal_capsule', 'insular_cortex', 'cerebellum', 'frontal_lobe', 'parietal_lobe', 'temporal_lobe', 'occipital_lobe', 'sinus_maxillary', 'sinus_frontal'])

const ORIENT: Record<Plane, [string, string, string, string]> = {
  axial: ['R', 'L', 'A', 'P'], coronal: ['R', 'L', 'S', 'I'], sagittal: ['A', 'P', 'S', 'I'],
}

export function Viewport(p: Props) {
  const { store, geo, plane, cursor } = p
  const meta = store.meta
  const wrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLCanvasElement>(null)
  const ovRef = useRef<HTMLCanvasElement>(null)
  const segRef = useRef<HTMLCanvasElement>(null)
  const segOffRef = useRef<HTMLCanvasElement | null>(null)
  const offRef = useRef<HTMLCanvasElement | null>(null)
  const imgDataRef = useRef<ImageData | null>(null)
  const lastGood = useRef<{ key: string; data: Int16Array } | null>(null)
  const [size, setSize] = useState({ w: 300, h: 300 })
  const [pan, setPan] = useState<[number, number]>([0, 0])
  const [freeScale, setFreeScale] = useState<number | null>(null) // pinch zoom (CSS px per mm)

  const dims = planeDims(geo, plane)
  const index = planeIndex(geo, plane, cursor)
  const count = planeCount(geo, plane)
  const needsVolume = plane !== 'axial'

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // reset pan / pinch when zoom preset, plane or series changes
  useEffect(() => { setPan([0, 0]); setFreeScale(null) }, [p.zoom, plane, meta.series, meta.study])

  // request decode for axial (progressive)
  const mipHalf = plane === 'axial' && p.mipMm ? Math.max(1, Math.round(p.mipMm / 2 / geo.stepMm)) : 0
  useEffect(() => { if (plane === 'axial') store.request(index, p.compact ? 0 : Math.max(6, mipHalf)) }, [store, plane, index, p.compact, mipHalf])
  useEffect(() => { if (plane === 'axial' && p.labels && p.seg?.show !== false) p.labels.request(index, p.compact ? 0 : 4) }, [p.labels, plane, index, p.compact, p.seg?.show])

  // physical scale: CSS px per mm
  const physW = dims.w * dims.pxW, physH = dims.h * dims.pxH
  const fitScale = Math.max(0.01, Math.min(size.w / physW, size.h / physH))
  const scale = freeScale ?? (p.zoom === 'fit' ? fitScale : p.zoom / geo.colMm)
  const dw = physW * scale, dh = physH * scale
  const offX = (size.w - dw) / 2 + pan[0]
  const offY = (size.h - dh) / 2 + pan[1]
  const zoomPct = Math.round(scale * geo.colMm * 100)

  // stored values for the displayed image
  const pixels = useMemo(() => {
    const key = `${meta.study}/${meta.series}/${plane}/${index}`
    let data: Int16Array | null = null
    if (plane === 'axial' && mipHalf) {
      // thick-slab MIP: per-pixel maximum of the stored values over the slab (display only)
      const lo = Math.max(0, index - mipHalf), hi = Math.min(geo.count - 1, index + mipHalf)
      const parts: Int16Array[] = []
      for (let k = lo; k <= hi; k++) { const s = store.peek(k); if (s) parts.push(s) }
      if (parts.length === hi - lo + 1) {
        const out = new Int16Array(parts[0])
        for (let j = 1; j < parts.length; j++) { const q = parts[j]; for (let i = 0; i < out.length; i++) if (q[i] > out[i]) out[i] = q[i] }
        data = out
      }
    } else if (plane === 'axial') data = store.peek(index)
    else if (p.volumeReady) { const vol = store.volumeData; if (vol) data = reformat(vol, geo, plane, index) }
    if (data) lastGood.current = { key, data }
    const showing = data ?? (lastGood.current && lastGood.current.key.startsWith(`${meta.study}/${meta.series}/${plane}/`) ? lastGood.current.data : null)
    return { data: showing, exact: !!data }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, plane, index, p.volumeReady, geo, p.version, meta, mipHalf])

  const lut = useMemo(() => makeLut(meta, p.center, p.width), [meta, p.center, p.width])

  // label values for the displayed image (separate layer)
  const labelPix = useMemo(() => {
    const L = p.labels
    if (!L) return null
    if (plane === 'axial' && mipHalf) {
      // label shown on the MIP: the label of the slice that holds each pixel's maximum is not tracked,
      // so use the nearest labelled slice to the centre (centre first, then outwards)
      const order: number[] = [index]
      for (let d = 1; d <= mipHalf; d++) order.push(index - d, index + d)
      const parts = order.filter((k) => k >= 0 && k < geo.count).map((k) => { L.request(k, 0); return L.peek(k) })
      if (parts.some((x) => !x)) return null
      const out = new Uint8Array(parts[0]!.length)
      for (const q of parts) for (let i = 0; i < out.length; i++) if (!out[i] && q![i]) out[i] = q![i]
      return out
    }
    if (plane === 'axial') return L.peek(index)
    const vol = L.volumeData
    return vol ? reformat(vol, geo, plane, index) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.labels, plane, index, geo, p.version, mipHalf])

  // one text anchor per label on this image: the member pixel nearest the label's centroid
  const anchors = useMemo(() => {
    const seg = p.seg, d = labelPix
    if (!seg || !d || !seg.show || !seg.text || p.compact || seg.quizOutline != null) return []
    const W = dims.w
    // bilateral structures that the model labels without a side get one name per side
    // (split at the structure's own centre column); not on sagittal images
    const split = (v: number) => plane !== 'sagittal' && PAIRED.has(seg.defs.get(v)?.source ?? '')
    const acc = new Map<number, [number, number, number]>()
    for (let i = 0; i < d.length; i++) { const v = d[i]; if (!v) continue; const e = acc.get(v); const x = i % W, y = (i / W) | 0; if (e) { e[0]++; e[1] += x; e[2] += y } else acc.set(v, [1, x, y]) }
    const minPx = 40 / (dims.pxW * dims.pxH)
    const out: { v: number; u: number; w: number; n: number }[] = []
    for (const [v, [nAll, sxAll]] of acc) {
      if (nAll < minPx || seg.hidden.has(v)) continue
      if (seg.isolate != null && v !== seg.isolate) continue
      if (seg.emphasis.size && !seg.emphasis.has(v)) continue
      const mid = sxAll / nAll
      const parts: ((x: number) => boolean)[] = split(v) ? [(x) => x < mid, (x) => x >= mid] : [() => true]
      for (const inPart of parts) {
        let n = 0, sx = 0, sy = 0
        for (let i = 0; i < d.length; i++) if (d[i] === v && inPart(i % W)) { n++; sx += i % W; sy += (i / W) | 0 }
        if (n < minPx) continue
        const cx = sx / n, cy = sy / n
        let best = -1, bd = Infinity
        for (let i = 0; i < d.length; i++) if (d[i] === v && inPart(i % W)) { const dd = (i % W - cx) ** 2 + (((i / W) | 0) - cy) ** 2; if (dd < bd) { bd = dd; best = i } }
        out.push({ v, u: best % W, w: (best / W) | 0, n })
      }
    }
    return out.sort((a, b) => b.n - a.n)
  }, [labelPix, p.seg, p.compact, dims, plane])

  // draw image layer (original pixels → VOI LUT; no filtering)
  useEffect(() => {
    const cv = imgRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(size.w * dpr); cv.height = Math.round(size.h * dpr)
    cv.style.width = `${size.w}px`; cv.style.height = `${size.h}px`
    const ctx = cv.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height)
    const d = pixels.data
    if (!d) return
    if (!offRef.current) offRef.current = document.createElement('canvas')
    const off = offRef.current
    if (off.width !== dims.w || off.height !== dims.h) { off.width = dims.w; off.height = dims.h }
    const octx = off.getContext('2d')!
    // reuse one ImageData per size: avoids allocating ~1 MB per frame while scrolling
    if (!imgDataRef.current || imgDataRef.current.width !== dims.w || imgDataRef.current.height !== dims.h) imgDataRef.current = octx.createImageData(dims.w, dims.h)
    const img = imgDataRef.current
    const px = img.data, L = lut.lut, lo = lut.min, top = L.length - 1
    for (let i = 0; i < d.length; i++) {
      let k = d[i] - lo; k = k < 0 ? 0 : k > top ? top : k
      const g = L[k], o = i << 2
      px[o] = g; px[o + 1] = g; px[o + 2] = g; px[o + 3] = 255
    }
    octx.putImageData(img, 0, 0)
    // Enlarged pixels are shown as blocks (nearest neighbour): no interpolation blur.
    // Only when the image is reduced below one device pixel per image pixel is
    // smoothing used, to avoid aliasing; that never alters the stored data.
    const devPerImgPx = Math.min(dims.pxW, dims.pxH) * scale * dpr
    ctx.imageSmoothingEnabled = devPerImgPx < 1
    ctx.imageSmoothingQuality = 'high'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.drawImage(off, offX, offY, dw, dh)
    // geometry of the drawn image, for automated pixel-fidelity tests
    Object.assign(cv.dataset, { offx: String(offX), offy: String(offY), pxw: String(dims.pxW * scale), pxh: String(dims.pxH * scale), w: String(dims.w), h: String(dims.h), dpr: String(dpr), smooth: String(ctx.imageSmoothingEnabled) })
  }, [pixels, lut, size, dims, scale, offX, offY, dw, dh])

  // segmentation layer: its own canvas between the CT image and the overlay
  useEffect(() => {
    const cv = segRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(size.w * dpr); cv.height = Math.round(size.h * dpr)
    cv.style.width = `${size.w}px`; cv.style.height = `${size.h}px`
    const ctx = cv.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height)
    const seg = p.seg, d = labelPix
    if (!seg || !d || (!seg.show && seg.quizOutline == null)) return
    if (!segOffRef.current) segOffRef.current = document.createElement('canvas')
    const off = segOffRef.current
    if (off.width !== dims.w || off.height !== dims.h) { off.width = dims.w; off.height = dims.h }
    const octx = off.getContext('2d')!
    const img = octx.createImageData(dims.w, dims.h), px = img.data, W = dims.w, H = dims.h
    const rgb = new Map<number, [number, number, number]>()
    for (const [id, def] of seg.defs) { const n = parseInt(def.color.slice(1), 16); rgb.set(id, [(n >> 16) & 255, (n >> 8) & 255, n & 255]) }
    const shown = (v: number) => v !== 0 && (seg.quizOutline != null ? v === seg.quizOutline : seg.isolate != null ? v === seg.isolate : seg.emphasis.size ? seg.emphasis.has(v) : !seg.hidden.has(v))
    const fillA = Math.round(seg.opacity * 255), edgeA = Math.round(Math.min(1, seg.opacity + 0.45) * 255)
    const outlineOnly = seg.outline || seg.quizOutline != null
    for (let i = 0; i < d.length; i++) {
      const v = d[i], o = i << 2
      if (shown(v)) {
        const c = rgb.get(v); if (!c) continue
        const x = i % W, y = (i / W) | 0
        const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1 || d[i - 1] !== v || d[i + 1] !== v || d[i - W] !== v || d[i + W] !== v
        if (!edge && outlineOnly) continue
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = edge ? edgeA : fillA
      } else if (seg.isolate != null && seg.quizOutline == null) {
        px[o + 3] = 150 // dim everything outside the isolated structure (overlay only; CT pixels untouched)
      }
    }
    octx.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.drawImage(off, offX, offY, dw, dh)
  }, [labelPix, p.seg, size, dims, offX, offY, dw, dh])

  // overlay layer (never touches the image canvas)
  useEffect(() => {
    const cv = ovRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(size.w * dpr); cv.height = Math.round(size.h * dpr)
    cv.style.width = `${size.w}px`; cv.style.height = `${size.h}px`
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    cv.dataset.exact = String(pixels.exact) // false while the requested image is still decoding
    const X = (u: number) => offX + (u + 0.5) * dims.pxW * scale
    const Y = (v: number) => offY + (v + 0.5) * dims.pxH * scale
    const font = (s: number, w = 600) => `${w} ${s}px -apple-system, system-ui, sans-serif`
    const halo = (t: string, x: number, y: number, fill: string) => {
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 3; ctx.strokeText(t, x, y); ctx.fillStyle = fill; ctx.fillText(t, x, y)
    }

    // axial level lines on reformats
    if (plane !== 'axial' && !p.compact) {
      ctx.font = font(11)
      for (const l of p.levels) {
        const [, v] = toImage(geo, plane, [0, 0, l.z])
        const y = Y(v)
        if (y < offY || y > offY + dh) continue
        const near = Math.abs(l.z - cursor[2]) < 1.5
        ctx.strokeStyle = near ? 'rgba(250,204,21,0.95)' : 'rgba(250,204,21,0.4)'
        ctx.setLineDash([5, 5]); ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(Math.max(0, offX), y); ctx.lineTo(Math.min(size.w, offX + dw), y); ctx.stroke(); ctx.setLineDash([])
        const name = LEVELS.find((x) => x.id === l.id)?.short ?? l.id
        ctx.textBaseline = 'bottom'
        halo(name, Math.min(size.w, offX + dw) - ctx.measureText(name).width - 6, y - 2, near ? '#facc15' : 'rgba(250,204,21,0.75)')
      }
    }

    // crosshair
    if (p.showCrosshair) {
      const [cu, cvv] = toImage(geo, plane, cursor)
      ctx.strokeStyle = p.accent; ctx.globalAlpha = 0.55; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(X(cu), 0); ctx.lineTo(X(cu), size.h); ctx.moveTo(0, Y(cvv)); ctx.lineTo(size.w, Y(cvv)); ctx.stroke()
      ctx.globalAlpha = 1
    }

    const placed: [number, number, number, number][] = [] // label boxes already drawn (landmarks first, then structures)
    // landmarks within ±1.5 mm of this plane
    if (p.showLandmarks && !p.compact) {
      const tol = 1.5
      ctx.font = font(12); ctx.textBaseline = 'middle'
      const boxes = placed // landmark names are placed first; structure names avoid them
      // markers are obstacles for every label except their own
      const markers: { id: string; x: number; y: number }[] = []
      const free = (x: number, y: number, w: number, own: string) =>
        !boxes.some((b) => x < b[0] + b[2] + 4 && x + w + 4 > b[0] && y - 8 < b[1] + b[3] && y + 8 > b[1]) &&
        !markers.some((m) => m.id !== own && x < m.x + 9 && x + w > m.x - 9 && y - 8 < m.y + 9 && y + 8 > m.y - 9)
      const here0 = toPatient(geo, plane, index, 0, 0)
      for (const lm of p.landmarks) {
        const d = plane === 'axial' ? Math.abs(lm.p[2] - here0[2]) : plane === 'coronal' ? Math.abs(lm.p[1] - here0[1]) : Math.abs(lm.p[0] - here0[0])
        if (d > (plane === 'axial' ? Math.max(tol, geo.stepMm / 2 + 0.01) : tol)) continue
        const [u, v] = toImage(geo, plane, lm.p); markers.push({ id: lm.id, x: X(u), y: Y(v) })
      }
      for (const lm of p.landmarks) {
        const here = toPatient(geo, plane, index, 0, 0)
        const d = plane === 'axial' ? Math.abs(lm.p[2] - here[2]) : plane === 'coronal' ? Math.abs(lm.p[1] - here[1]) : Math.abs(lm.p[0] - here[0])
        const lim = plane === 'axial' ? Math.max(tol, geo.stepMm / 2 + 0.01) : tol
        if (d > lim) continue
        const hi = p.highlight?.has(lm.id) || p.highlight?.has(lm.id.replace(/-(r|l)$/, ''))
        const [u, v] = toImage(geo, plane, lm.p)
        const x = X(u), y = Y(v)
        ctx.strokeStyle = hi ? '#fb7185' : '#facc15'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke()
        if (p.showLabels) {
          const t = lm.name + (lm.approx ? ' (approx.)' : '')
          const tw = ctx.measureText(t).width
          let tx = x + 11 + tw > size.w ? x - 11 - tw : x + 11, ty = y
          if (!free(tx, ty, tw, lm.id)) {
            // try the other side, then step downwards with a leader line
            const alt = tx > x ? x - 11 - tw : x + 11
            if (alt >= 0 && alt + tw <= size.w && free(alt, ty, tw, lm.id)) tx = alt
            else for (let k = 1; k <= 6 && !free(tx, ty, tw, lm.id); k++) ty = y + k * 16
            if (ty !== y) { ctx.strokeStyle = 'rgba(253,230,138,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + 7); ctx.lineTo(tx > x ? tx - 2 : tx + tw + 2, ty); ctx.stroke() }
          }
          boxes.push([tx, ty - 8, tw, 16])
          halo(t, tx, ty, hi ? '#fecdd3' : '#fde68a')
        }
      }
    }

    // segmentation names on this image
    if (anchors.length && p.seg) {
      ctx.font = font(11); ctx.textBaseline = 'middle'
      for (const a of anchors) {
        const def = p.seg.defs.get(a.v); if (!def) continue
        const x = X(a.u), y = Y(a.w)
        const t = def.name.replace(/ \((putamen|calvarium|atrium)[^)]*\)/, '').replace(' / cisterns', '')
        const tw = ctx.measureText(t).width
        let tx = x + 5, ty = y
        const clash = (bx: number, by: number) => bx < 0 || bx + tw > size.w || placed.some((b) => bx < b[0] + b[2] + 3 && bx + tw + 3 > b[0] && by - 7 < b[1] + b[3] && by + 7 > b[1])
        let k = 0
        while (clash(tx, ty) && k < 8) { k++; ty = y + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 14; if (k === 4) tx = x - 5 - tw }
        if (clash(tx, ty)) continue
        placed.push([tx, ty - 7, tw, 14])
        ctx.fillStyle = def.color; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill()
        halo(t, tx, ty, '#ffffff')
      }
    }

    // measurement
    const m = p.measure
    if (m && m.plane === plane && m.index === index) {
      const x1 = X(m.a[0]), y1 = Y(m.a[1]), x2 = X(m.b[0]), y2 = Y(m.b[1])
      const mm = Math.hypot((m.b[0] - m.a[0]) * dims.pxW, (m.b[1] - m.a[1]) * dims.pxH)
      ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      ctx.font = font(13); ctx.textBaseline = 'bottom'
      halo(`${mm.toFixed(1)} mm`, (x1 + x2) / 2 + 8, (y1 + y2) / 2 - 6, '#4ade80')
    }

    // orientation + status text
    const [Lt, Rt, Tp, Bt] = ORIENT[plane]
    ctx.font = font(p.compact ? 10 : 13); ctx.textBaseline = 'middle'
    halo(Lt, 6, size.h / 2, 'rgba(255,255,255,0.85)')
    halo(Rt, size.w - 14, size.h / 2, 'rgba(255,255,255,0.85)')
    ctx.textBaseline = 'top'; halo(Tp, size.w / 2 - 4, 6, 'rgba(255,255,255,0.85)')
    ctx.textBaseline = 'bottom'; halo(Bt, size.w / 2 - 4, size.h - 6, 'rgba(255,255,255,0.85)')
    ctx.font = font(p.compact ? 10 : 12, 500); ctx.textBaseline = 'top'
    const pos = plane === 'axial' ? `z ${geo.z[index].toFixed(1)} mm` : plane === 'coronal' ? `y ${(geo.y0 + index * geo.rowMm).toFixed(1)} mm` : `x ${(geo.x0 + index * geo.colMm).toFixed(1)} mm`
    halo(`${p.examLabel ? p.examLabel + ' · ' : ''}${plane} ${index + 1}/${count} · ${pos}${mipHalf ? ` · MIP ${p.mipMm} mm` : ''}`, 8, 8, 'rgba(255,255,255,0.85)')
    if (!p.compact) {
      halo(`W ${Math.round(p.width)} L ${Math.round(p.center)} · ${zoomPct}%`, 8, 26, 'rgba(255,255,255,0.7)')
      if (!pixels.exact) { ctx.textBaseline = 'bottom'; halo(needsVolume && !p.volumeReady ? 'Full volume not loaded' : 'Decoding slice…', 8, size.h - 8, '#fbbf24') }
    }
  }, [size, plane, cursor, index, count, geo, dims, scale, offX, offY, dw, dh, p.levels, p.landmarks, p.showLandmarks, p.showLabels, p.showCrosshair, p.highlight, p.accent, p.compact, p.measure, p.center, p.width, zoomPct, pixels.exact, needsVolume, p.volumeReady, anchors, p.seg, p.examLabel, mipHalf, p.mipMm])

  /* -------------------------------------------------------- interaction */

  const toImg = useCallback((cx: number, cy: number): [number, number] | null => {
    const r = ovRef.current!.getBoundingClientRect()
    const u = (cx - r.left - offX) / (dims.pxW * scale) - 0.5
    const v = (cy - r.top - offY) / (dims.pxH * scale) - 0.5
    if (u < -0.5 || v < -0.5 || u > dims.w - 0.5 || v > dims.h - 0.5) return null
    return [u, v]
  }, [offX, offY, dims, scale])

  const hoverAt = useCallback((uv: [number, number]): Hover => {
    const u = Math.round(uv[0]), v = Math.round(uv[1])
    const pt = toPatient(geo, plane, index, u, v)
    const d = pixels.exact ? pixels.data : null
    const stored = d ? d[v * dims.w + u] : NaN
    const hu = Number.isNaN(stored) || stored === meta.pixelPaddingValue ? null : huOf(meta, stored)
    let landmark: Landmark | null = null
    for (const lm of p.landmarks) if (Math.hypot(lm.p[0] - pt[0], lm.p[1] - pt[1], lm.p[2] - pt[2]) < 6) landmark = lm
    const lv = labelPix ? labelPix[v * dims.w + u] : 0
    const label = lv && p.seg ? p.seg.defs.get(lv) ?? null : null
    return { p: pt, stored, hu, landmark, label }
  }, [geo, plane, index, pixels, dims, meta, p.landmarks, labelPix, p.seg])

  const stepSlices = useCallback((n: number) => {
    const c: Patient = [...cursor]
    if (plane === 'axial') {
      const k = Math.max(0, Math.min(geo.count - 1, index + n)); c[2] = geo.z[k]
    } else if (plane === 'coronal') {
      const r = Math.max(0, Math.min(geo.rows - 1, index - n)); c[1] = geo.y0 + r * geo.rowMm // up = anterior
    } else {
      const k = Math.max(0, Math.min(geo.cols - 1, index + n)); c[0] = geo.x0 + k * geo.colMm
    }
    p.onCursor(c)
  }, [cursor, plane, index, geo, p])

  const ptrs = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{
    mode: 'touch-scroll' | 'pinch' | 'mouse-cursor' | 'mouse-pan' | 'window' | 'measure'
    x: number; y: number; acc: number; moved: boolean; pan0: [number, number]; scale0: number; dist0: number; mid0: [number, number]
    c0: number; w0: number; uv0?: [number, number]
  } | null>(null)

  const onDown = (e: React.PointerEvent) => {
    p.onActivate?.()
    if (p.compact) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const base = { x: e.clientX, y: e.clientY, acc: 0, moved: false, pan0: pan, scale0: scale, dist0: 0, mid0: [0, 0] as [number, number], c0: p.center, w0: p.width }
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()]
      gesture.current = { ...base, mode: 'pinch', dist0: Math.hypot(a.x - b.x, a.y - b.y), mid0: [(a.x + b.x) / 2, (a.y + b.y) / 2] }
      return
    }
    if (e.pointerType === 'touch') {
      if (p.measureMode) { const uv = toImg(e.clientX, e.clientY); if (uv) { gesture.current = { ...base, mode: 'measure', uv0: uv }; p.onMeasure?.({ plane, index, a: uv, b: uv }) } return }
      gesture.current = { ...base, mode: 'touch-scroll' }
      return
    }
    if (e.button === 2 || e.shiftKey) { gesture.current = { ...base, mode: 'window' }; return }
    if (p.measureMode) { const uv = toImg(e.clientX, e.clientY); if (uv) { gesture.current = { ...base, mode: 'measure', uv0: uv }; p.onMeasure?.({ plane, index, a: uv, b: uv }) } return }
    gesture.current = { ...base, mode: p.zoom === 'fit' && freeScale == null ? 'mouse-cursor' : 'mouse-pan' }
  }

  const onMove = (e: React.PointerEvent) => {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const uv = toImg(e.clientX, e.clientY)
    if (e.pointerType !== 'touch') p.onHover?.(uv ? hoverAt(uv) : null)
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.x, dy = e.clientY - g.y
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) g.moved = true
    if (g.mode === 'pinch' && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid: [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2]
      const s = Math.max(fitScale * 0.5, Math.min(16 / geo.colMm, g.scale0 * dist / Math.max(1, g.dist0)))
      setFreeScale(s)
      setPan([g.pan0[0] + (mid[0] - g.mid0[0]), g.pan0[1] + (mid[1] - g.mid0[1])])
    } else if (g.mode === 'touch-scroll') {
      // ~7 CSS px of finger travel per slice; swipe up = superior (axial)
      const target = Math.round(-dy / 7)
      if (target !== g.acc) { stepSlices(target - g.acc); g.acc = target }
    } else if (g.mode === 'mouse-pan') {
      setPan([g.pan0[0] + dx, g.pan0[1] + dy])
    } else if (g.mode === 'mouse-cursor' && uv) {
      p.onCursor(toPatient(geo, plane, index, Math.round(uv[0]), Math.round(uv[1])))
    } else if (g.mode === 'window') {
      p.onWindow?.(Math.round(g.c0 - dy), Math.max(1, Math.round(g.w0 + dx * 2)))
    } else if (g.mode === 'measure' && uv && g.uv0) {
      p.onMeasure?.({ plane, index, a: g.uv0, b: uv })
    }
  }

  const onUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId)
    const g = gesture.current
    if (g && !g.moved && (g.mode === 'touch-scroll' || g.mode === 'mouse-cursor' || g.mode === 'mouse-pan')) {
      const uv = toImg(e.clientX, e.clientY)
      if (uv) {
        const h = hoverAt(uv)
        p.onCursor(h.p); p.onHover?.(h); p.onPick?.(h)
      }
    }
    if (g?.mode === 'pinch' && ptrs.current.size === 1) {
      const [only] = [...ptrs.current.values()]
      gesture.current = { ...g, mode: 'touch-scroll', x: only.x, y: only.y, acc: 0, moved: true }
      return
    }
    if (ptrs.current.size === 0) gesture.current = null
  }

  // wheel: slices; ctrl/⌘ + wheel or trackpad pinch: zoom
  useEffect(() => {
    const el = ovRef.current
    if (!el || p.compact) return
    let acc = 0
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        setFreeScale((s) => Math.max(fitScale * 0.5, Math.min(16 / geo.colMm, (s ?? scale) * Math.exp(-e.deltaY * 0.01))))
        return
      }
      acc += e.deltaY
      const n = Math.trunc(acc / 40)
      if (n) { acc -= n * 40; stepSlices(-n * (e.shiftKey ? 5 : 1)) }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [stepSlices, fitScale, scale, geo, p.compact])

  return (
    <div ref={wrapRef} className={`ctv${p.compact ? ' ctv-compact' : ''}`} onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={imgRef} className="ctv-img" aria-hidden="true" />
      <canvas ref={segRef} className="ctv-seg" aria-hidden="true" />
      <canvas
        ref={ovRef}
        className="ctv-ov"
        role="img"
        aria-label={`${plane} CT image ${index + 1} of ${count}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={(e) => { if (e.pointerType !== 'touch') p.onHover?.(null) }}
      />
    </div>
  )
}
