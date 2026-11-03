import { useEffect, useMemo, useRef, useState } from 'react'
import type { Plane } from './content'
import { LEVELS } from './content'
import {
  extractSlice, planeGeom, sliceOf, toColRow, toVoxel, clampVoxel,
  type Volume, type Voxel,
} from './volume'

export interface OverlayState {
  show: boolean
  opacity: number
  outline: boolean
  text: boolean
  hidden: Set<number>        // label values switched off
  isolate: number | null     // only this label, image dimmed outside
  emphasis: Set<number>      // when non-empty: only these labels are drawn (level / clinical focus)
  landmarks: boolean
  emphasisLandmarks: Set<string>
}

export interface HoverInfo { voxel: Voxel; hu: number; label: number; landmark: string | null }

export interface MeasureLine { plane: Plane; slice: number; a: [number, number]; b: [number, number] }

interface Props {
  vol: Volume
  plane: Plane
  cursor: Voxel
  onCursor: (v: Voxel) => void
  win: { level: number; width: number }
  onWindow: (w: { level: number; width: number }) => void
  overlay: OverlayState
  compact?: boolean
  active?: boolean
  onActivate?: () => void
  onHover?: (h: HoverInfo | null) => void
  onPick?: (h: HoverInfo) => void
  measureMode?: boolean
  measure: MeasureLine | null
  onMeasure?: (m: MeasureLine | null) => void
  hideText?: boolean
  quizOutline?: number | null   // draw only this label as an outline (quiz)
  showCrosshair: boolean
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const ORIENT: Record<Plane, [string, string, string, string]> = {
  // left, right, top, bottom
  axial: ['R', 'L', 'A', 'P'],
  coronal: ['R', 'L', 'S', 'I'],
  sagittal: ['A', 'P', 'S', 'I'],
}

export function SliceView(p: Props) {
  const { vol, plane, cursor, win, overlay } = p
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 300, h: 300 })
  const geom = useMemo(() => planeGeom(vol, plane), [vol, plane])
  const slice = sliceOf(plane, cursor)
  const data = useMemo(() => extractSlice(vol, plane, slice), [vol, plane, slice])
  const drag = useRef<{ mode: 'cursor' | 'window' | 'measure' | 'touch'; x: number; y: number; win: { level: number; width: number }; slice0?: number; moved?: boolean } | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // physical fit
  const physW = geom.w * geom.colMm
  const physH = geom.h * geom.rowMm
  const scale = Math.max(0.01, Math.min(size.w / physW, size.h / physH)) // css px per mm
  const offX = (size.w - physW * scale) / 2
  const offY = (size.h - physH * scale) / 2

  // native-resolution image
  const image = useMemo(() => {
    const { w, h, hu, lab } = data
    const img = new ImageData(w, h)
    const lo = win.level - win.width / 2
    const inv = 255 / Math.max(1, win.width)
    const colors = new Map<number, [number, number, number]>()
    for (const [k, d] of vol.labelDefs) colors.set(k, hexToRgb(d.color))
    const showLab = !!lab && (overlay.show || p.quizOutline != null)
    const drawn = (v: number): boolean => {
      if (!v) return false
      if (p.quizOutline != null) return v === p.quizOutline
      if (overlay.isolate != null) return v === overlay.isolate
      if (overlay.emphasis.size) return overlay.emphasis.has(v)
      return !overlay.hidden.has(v)
    }
    const a = overlay.opacity
    const isolate = overlay.isolate
    for (let i = 0; i < w * h; i++) {
      let g = (hu[i] - lo) * inv
      g = g < 0 ? 0 : g > 255 ? 255 : g
      let r = g, gg = g, b = g
      if (lab) {
        const v = lab[i]
        if (isolate != null && v !== isolate && overlay.show) { r *= 0.35; gg *= 0.35; b *= 0.35 }
        if (showLab && drawn(v)) {
          const c = colors.get(v)
          if (c) {
            const x = i % w, y = (i / w) | 0
            const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
              lab[i - 1] !== v || lab[i + 1] !== v || lab[i - w] !== v || lab[i + w] !== v
            const outlineOnly = overlay.outline || p.quizOutline != null
            const al = edge ? Math.min(1, a + 0.35) : outlineOnly ? 0 : a
            r = r * (1 - al) + c[0] * al
            gg = gg * (1 - al) + c[1] * al
            b = b * (1 - al) + c[2] * al
          }
        }
      }
      const o = i * 4
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255
    }
    return img
  }, [data, win.level, win.width, overlay, vol, p.quizOutline])

  // label text anchors for this slice
  const anchors = useMemo(() => {
    const { w, h, lab } = data
    if (!lab || !overlay.show || !overlay.text) return []
    const midCol = plane === 'sagittal' ? -1 : vol.nx / 2
    const acc = new Map<string, { v: number; n: number; sc: number; sr: number }>()
    for (let i = 0; i < w * h; i++) {
      const v = lab[i]
      if (!v) continue
      const d = vol.labelDefs.get(v)
      if (!d) continue
      const col = i % w
      const side = d.midline || midCol < 0 ? 'm' : col < midCol ? 'r' : 'l'
      const key = `${v}:${side}`
      let e = acc.get(key)
      if (!e) acc.set(key, (e = { v, n: 0, sc: 0, sr: 0 }))
      e.n++; e.sc += col; e.sr += (i / w) | 0
    }
    const minPx = 30 / (geom.colMm * geom.rowMm)
    const out: { v: number; col: number; row: number; side: string }[] = []
    for (const [key, e] of acc) {
      if (e.n < minPx) continue
      const v = e.v
      if (overlay.isolate != null && v !== overlay.isolate) continue
      if (overlay.emphasis.size && !overlay.emphasis.has(v)) continue
      if (overlay.hidden.has(v)) continue
      const cc = e.sc / e.n, cr = e.sr / e.n
      // nearest member pixel to the centroid (keeps labels on C-shaped structures)
      let best = -1, bd = Infinity
      const side = key.split(':')[1]
      for (let i = 0; i < w * h; i++) {
        if (lab[i] !== v) continue
        const col = i % w
        if (side === 'r' && col >= midCol) continue
        if (side === 'l' && col < midCol) continue
        const dd = (col - cc) ** 2 + (((i / w) | 0) - cr) ** 2
        if (dd < bd) { bd = dd; best = i }
      }
      if (best >= 0) out.push({ v, col: best % w, row: (best / w) | 0, side })
    }
    return out
  }, [data, overlay, plane, vol, geom])

  // draw
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(size.w * dpr)
    cv.height = Math.round(size.h * dpr)
    cv.style.width = `${size.w}px`
    cv.style.height = `${size.h}px`
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size.w, size.h)
    const off = document.createElement('canvas')
    off.width = image.width; off.height = image.height
    off.getContext('2d')!.putImageData(image, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    const dw = physW * scale, dh = physH * scale
    ctx.drawImage(off, offX, offY, dw, dh)

    const px = (col: number) => offX + (col + 0.5) * geom.colMm * scale
    const py = (row: number) => offY + (row + 0.5) * geom.rowMm * scale

    // axial level lines on coronal/sagittal
    if (plane !== 'axial' && !p.compact && vol.meta.levels.length) {
      ctx.save()
      ctx.font = '10px system-ui, sans-serif'
      for (const l of vol.meta.levels) {
        const row = vol.nz - 1 - l.z
        const y = py(row)
        const near = Math.abs(l.z - cursor[2]) < 1
        ctx.strokeStyle = near ? 'rgba(250,204,21,0.9)' : 'rgba(250,204,21,0.35)'
        ctx.setLineDash([4, 4])
        ctx.beginPath(); ctx.moveTo(offX, y); ctx.lineTo(offX + dw, y); ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = near ? 'rgba(250,204,21,1)' : 'rgba(250,204,21,0.6)'
        const name = LEVELS.find((x) => x.id === l.id)?.short ?? l.id
        ctx.fillText(name, offX + dw - ctx.measureText(name).width - 4, y - 3)
      }
      ctx.restore()
    }

    // crosshair
    if (p.showCrosshair) {
      const [cc, cr] = toColRow(vol, plane, cursor)
      ctx.strokeStyle = 'rgba(56,189,248,0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(px(cc), offY); ctx.lineTo(px(cc), offY + dh)
      ctx.moveTo(offX, py(cr)); ctx.lineTo(offX + dw, py(cr))
      ctx.stroke()
    }

    // text labels
    if (!p.hideText && !p.compact && anchors.length) {
      ctx.save()
      ctx.font = '600 11px system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      const boxes: [number, number, number, number][] = []
      for (const a of anchors) {
        const d = vol.labelDefs.get(a.v)!
        const x = px(a.col), y = py(a.row)
        const text = d.name.replace(/ \(.*\)$/, '').replace(' / cisterns', '')
        const tw = ctx.measureText(text).width
        let tx = x + 6, ty = y
        if (tx + tw > size.w - 4) tx = x - 6 - tw
        for (let k = 0; k < 6 && boxes.some((bx) => tx < bx[0] + bx[2] && tx + tw > bx[0] && ty - 7 < bx[1] + bx[3] && ty + 7 > bx[1]); k++) ty += 14
        boxes.push([tx, ty - 7, tw, 14])
        ctx.fillStyle = d.color
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 3
        ctx.strokeText(text, tx, ty)
        ctx.fillStyle = '#fff'
        ctx.fillText(text, tx, ty)
      }
      ctx.restore()
    }

    // landmarks within ±2 slices
    if (overlay.landmarks && !p.compact) {
      ctx.save()
      ctx.font = '600 11px system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      for (const lm of vol.meta.landmarks) {
        if (Math.abs(sliceOf(plane, lm.xyz) - slice) > 2) continue
        if (overlay.emphasisLandmarks.size && !overlay.emphasisLandmarks.has(lm.id)) continue
        const [c, r] = toColRow(vol, plane, lm.xyz)
        const x = px(c), y = py(r)
        ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke()
        if (!p.hideText) {
          const text = lm.name + (lm.approx ? ' (approx.)' : '')
          const tw = ctx.measureText(text).width
          const tx = x + 10 + tw > size.w ? x - 10 - tw : x + 10
          ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 3
          ctx.strokeText(text, tx, y)
          ctx.fillStyle = '#fde68a'; ctx.fillText(text, tx, y)
        }
      }
      ctx.restore()
    }

    // measurement
    const m = p.measure
    if (m && m.plane === plane && m.slice === slice) {
      const x1 = px(m.a[0]), y1 = py(m.a[1]), x2 = px(m.b[0]), y2 = py(m.b[1])
      const mm = Math.hypot((m.b[0] - m.a[0]) * geom.colMm, (m.b[1] - m.a[1]) * geom.rowMm)
      ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      ctx.fillStyle = '#4ade80'
      for (const [x, y] of [[x1, y1], [x2, y2]]) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill() }
      ctx.font = '600 12px system-ui, sans-serif'
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 3
      const t = `${mm.toFixed(1)} mm`
      ctx.strokeText(t, (x1 + x2) / 2 + 6, (y1 + y2) / 2 - 6)
      ctx.fillText(t, (x1 + x2) / 2 + 6, (y1 + y2) / 2 - 6)
    }

    // orientation letters + slice number
    const [L, R, T, B] = ORIENT[plane]
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.font = `600 ${p.compact ? 10 : 12}px system-ui, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.fillText(L, offX + 4, offY + dh / 2)
    ctx.fillText(R, offX + dw - 12, offY + dh / 2)
    ctx.textBaseline = 'top'
    ctx.fillText(T, offX + dw / 2 - 4, offY + 4)
    ctx.textBaseline = 'bottom'
    ctx.fillText(B, offX + dw / 2 - 4, offY + dh - 4)
    ctx.textBaseline = 'top'
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.fillText(`${plane} ${slice + 1}/${geom.count}`, 6, 6)
  }, [image, anchors, size, cursor, plane, slice, overlay, p.measure, p.compact, p.hideText, p.showCrosshair, vol, geom, scale, offX, offY, physW, physH])

  /* ------------------------------------------------------- interaction */

  const eventToColRow = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const r = canvasRef.current!.getBoundingClientRect()
    const col = (e.clientX - r.left - offX) / (geom.colMm * scale) - 0.5
    const row = (e.clientY - r.top - offY) / (geom.rowMm * scale) - 0.5
    if (col < -0.5 || row < -0.5 || col > geom.w - 0.5 || row > geom.h - 0.5) return null
    return [col, row]
  }

  const info = (cr: [number, number]): HoverInfo => {
    const vx = clampVoxel(vol, toVoxel(vol, plane, slice, cr[0], cr[1]))
    const i = (vx[2] * vol.ny + vx[1]) * vol.nx + vx[0]
    let landmark: string | null = null
    for (const lm of vol.meta.landmarks) {
      const d = Math.hypot((lm.xyz[0] - vx[0]) * vol.sx, (lm.xyz[1] - vx[1]) * vol.sy, (lm.xyz[2] - vx[2]) * vol.sz)
      if (d < 6) landmark = lm.id
    }
    return { voxel: vx, hu: vol.hu[i], label: vol.labels ? vol.labels[i] : 0, landmark }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    p.onActivate?.()
    const cr = eventToColRow(e)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const windowDrag = e.button === 2 || e.shiftKey
    if (windowDrag) {
      drag.current = { mode: 'window', x: e.clientX, y: e.clientY, win: { ...win } }
      return
    }
    if (!cr) return
    if (p.measureMode) {
      drag.current = { mode: 'measure', x: cr[0], y: cr[1], win }
      p.onMeasure?.({ plane, slice, a: cr, b: cr })
      return
    }
    if (e.pointerType === 'touch' && !p.compact) {
      // iPad / phone: one-finger vertical swipe scrolls slices, a tap places
      // the crosshair and identifies what is under the finger.
      drag.current = { mode: 'touch', x: e.clientX, y: e.clientY, win, slice0: slice, moved: false }
      return
    }
    drag.current = { mode: 'cursor', x: e.clientX, y: e.clientY, win }
    const h = info(cr)
    p.onCursor(h.voxel)
    p.onPick?.(h)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const cr = eventToColRow(e)
    p.onHover?.(cr ? info(cr) : null)
    const d = drag.current
    if (!d) return
    if (d.mode === 'window') {
      const width = Math.max(1, d.win.width + (e.clientX - d.x) * 2)
      const level = d.win.level - (e.clientY - d.y) * 1
      p.onWindow({ level: Math.round(level), width: Math.round(width) })
    } else if (d.mode === 'touch') {
      const dy = e.clientY - d.y
      if (Math.abs(dy) > 8 || Math.abs(e.clientX - d.x) > 8) d.moved = true
      if (d.moved) {
        const c: Voxel = [...cursor]
        const axis = plane === 'axial' ? 2 : plane === 'coronal' ? 1 : 0
        const n = Math.round(-dy / 6)
        c[axis] = (d.slice0 ?? 0) + (plane === 'coronal' ? -n : n)
        p.onCursor(clampVoxel(vol, c))
      }
    } else if (d.mode === 'measure' && cr) {
      p.onMeasure?.({ plane, slice, a: [d.x, d.y], b: cr })
    } else if (d.mode === 'cursor' && cr) {
      p.onCursor(info(cr).voxel)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d?.mode === 'touch' && !d.moved) {
      const cr = eventToColRow(e)
      if (!cr) return
      const h = info(cr)
      p.onCursor(h.voxel)
      p.onHover?.(h)
      p.onPick?.(h)
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    const step = (e.deltaY > 0 ? -1 : 1) * (e.shiftKey ? 5 : 1)
    const c: Voxel = [...cursor]
    const axis = plane === 'axial' ? 2 : plane === 'coronal' ? 1 : 0
    // axial: wheel up = superior; coronal: wheel up = anterior; sagittal: wheel up = patient left
    c[axis] += plane === 'coronal' ? -step : step
    p.onCursor(clampVoxel(vol, c))
  }

  return (
    <div
      ref={wrapRef}
      className={`ct-view${p.active ? ' is-active' : ''}${p.compact ? ' is-compact' : ''}`}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={(e) => { if (e.pointerType !== 'touch') p.onHover?.(null) }}
        aria-label={`${plane} CT slice ${slice + 1} of ${geom.count}`}
        role="img"
      />
    </div>
  )
}
