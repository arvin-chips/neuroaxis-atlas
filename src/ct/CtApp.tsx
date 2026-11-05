import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getAtlasRecord } from './atlas'
import { CLINICAL, LEVELS, LEVEL_ARTERIES, STRUCTURES, WINDOWS, type ClinicalTopic } from './content'
import {
  DATA_BASE, loadAnnotations, loadIndex, loadSeriesMeta, SeriesStore,
  type Annotations, type DataIndex, type ExamInfo, type SeriesMeta,
} from './data'
import { geoOf, planeCount, planeIndex, type Geo, type Patient, type Plane } from './geometry'
import { Viewport, type Hover, type Measure, type Zoom } from './Viewport'
import { baseId, checkFind, findQuestion, levelQuestion, type Question, type QuizKind } from './quiz'
import { offlineStatus, registerServiceWorker, saveOffline } from './offline'

type Tab = 'level' | 'structure' | 'clinical' | 'quiz' | 'exam'
const PLANES: Plane[] = ['axial', 'coronal', 'sagittal']
const ZOOMS: { id: Zoom; label: string }[] = [{ id: 'fit', label: 'Fit' }, { id: 1, label: '100%' }, { id: 2, label: '200%' }, { id: 4, label: '400%' }]
const ACCENT: Record<string, string> = { 'CQ500-CT-235': '#38bdf8', 'CQ500-CT-298': '#f59e0b' }
const key = (study: string, series: string) => `${study}/${series}`
const fmtMB = (b: number) => `${(b / 1e6).toFixed(1)} MB`
const seriesLabel = (s: string) => s.startsWith('axial-5mm') ? '5 mm axial' : s.includes('bone') ? '0.625 mm bone' : '0.625 mm thin'

export default function CtApp() {
  const [index, setIndex] = useState<DataIndex | null>(null)
  const [metas, setMetas] = useState<Map<string, SeriesMeta>>(new Map())
  const [notes, setNotes] = useState<Map<string, Annotations>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [examId, setExamId] = useState('CQ500-CT-235')
  const [seriesId, setSeriesId] = useState('axial-5mm-standard')
  const [cursors, setCursors] = useState<Map<string, Patient>>(new Map())
  const [plane, setPlane] = useState<Plane>('axial')
  const [win, setWin] = useState({ c: 40, w: 80 })
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [tab, setTab] = useState<Tab>('level')
  const [hover, setHover] = useState<Hover | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [showLandmarks, setShowLandmarks] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [crosshair, setCrosshair] = useState(true)
  const [measureMode, setMeasureMode] = useState(false)
  const [measure, setMeasure] = useState<Measure | null>(null)
  const [focus, setFocus] = useState<{ kind: 'level' | 'clinical'; id: string } | null>(null)
  const [clinicalId, setClinicalId] = useState(CLINICAL[0].id)
  const [sidebar, setSidebar] = useState(false)
  // The 3-plane volume itself is owned by its SeriesStore; React only keeps which series has it ready.
  const [volKey, setVolKey] = useState<string | null>(null)
  const [volProgress, setVolProgress] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [quizKind, setQuizKind] = useState<QuizKind>('level')
  const [question, setQuestion] = useState<Question | null>(null)
  const [answer, setAnswer] = useState<{ given: string; ok: boolean } | null>(null)
  const [score, setScore] = useState({ right: 0, total: 0 })
  const [offline, setOffline] = useState<{ cached: number; total: number; progress?: string }>({ cached: 0, total: 0 })
  const stores = useRef(new Map<string, SeriesStore>())

  /* ------------------------------------------------------------ loading */

  useEffect(() => {
    registerServiceWorker()
    ;(async () => {
      const idx = await loadIndex()
      const ms = new Map<string, SeriesMeta>(), ns = new Map<string, Annotations>(), cs = new Map<string, Patient>()
      await Promise.all(idx.exams.flatMap((e) => [
        loadAnnotations(e.id).then((a) => ns.set(e.id, a)),
        ...e.series.map((s) => loadSeriesMeta(e.id, s).then((m) => ms.set(key(e.id, s), m))),
      ]))
      for (const e of idx.exams) {
        const m = ms.get(key(e.id, e.series[e.series.length - 1]))!
        const g = geoOf(m)
        const z = ns.get(e.id)?.levels.find((l) => l.id === (e.id === 'CQ500-CT-298' ? 'pons' : 'third-ventricle'))?.z ?? g.z[g.count >> 1]
        cs.set(e.id, [g.x0 + (g.cols / 2) * g.colMm, g.y0 + (g.rows / 2) * g.rowMm, z])
      }
      setMetas(ms); setNotes(ns); setCursors(cs); setIndex(idx)
      setOffline(await offlineStatus(idx, [...ms.values()]))
    })().catch((e) => setError(`Could not load the image data from ${DATA_BASE}: ${e instanceof Error ? e.message : e}`))
  }, [])

  const exam = index?.exams.find((e) => e.id === examId) ?? null
  const meta = metas.get(key(examId, seriesId)) ?? null
  const geo: Geo | null = useMemo(() => (meta ? geoOf(meta) : null), [meta])
  const ann = notes.get(examId) ?? null
  const cursor = cursors.get(examId) ?? null
  const accent = ACCENT[examId] ?? '#38bdf8'

  const storeFor = useCallback((study: string, series: string) => {
    const k = key(study, series)
    let s = stores.current.get(k)
    if (!s) { const m = metas.get(k); if (!m) return null; s = new SeriesStore(m); stores.current.set(k, s) }
    return s
  }, [metas])
  const store = meta ? storeFor(examId, seriesId) : null

  // redraw when the store decodes slices
  useEffect(() => store?.onChange(() => setVersion((v) => v + 1)), [store])

  // keep only the stores of the current exam alive; drop other exams' memory
  useEffect(() => {
    for (const [k, s] of stores.current) if (!k.startsWith(`${examId}/`)) { s.dispose(); stores.current.delete(k) }
    setVolKey((k) => (k && !k.startsWith(`${examId}/`) ? null : k))
  }, [examId])

  const setCursor = useCallback((p: Patient) => setCursors((m) => new Map(m).set(examId, p)), [examId])

  // MPR needs the thin series' full volume
  const thinSeries = exam?.series.find((s) => !s.startsWith('axial-5mm')) ?? null
  const mprKey = thinSeries ? key(examId, thinSeries) : null
  const volumeReady = !!mprKey && volKey === mprKey && !!stores.current.get(mprKey)?.hasVolume
  const loadVolume = useCallback(async () => {
    if (!thinSeries || !mprKey) return
    const s = storeFor(examId, thinSeries)
    if (!s) return
    setVolProgress('0%')
    const t0 = performance.now()
    await s.loadVolume((d, t) => setVolProgress(`${Math.round((100 * d) / t)}%`))
    console.info(`[ct-anatomy] volume ${mprKey}: ${s.meta.count} slices in ${Math.round(performance.now() - t0)} ms`)
    setVolKey(mprKey); setVolProgress(null)
  }, [thinSeries, mprKey, examId, storeFor])

  const choosePlane = (pl: Plane) => {
    setPlane(pl)
    if (pl !== 'axial' && seriesId.startsWith('axial-5mm') && thinSeries) setSeriesId(thinSeries)
    if (pl !== 'axial' && !volumeReady && !volProgress) void loadVolume()
  }

  const chooseExam = (id: string) => {
    if (id === examId) return
    const e = index?.exams.find((x) => x.id === id)
    if (!e) return
    setExamId(id); setSeriesId(e.series[0]); setPlane('axial'); setMeasure(null); setFocus(null); setSelected(null)
    setQuestion(null); setAnswer(null)
    const w = WINDOWS.find((x) => x.id === (id === 'CQ500-CT-298' ? 'bone' : 'brain'))!
    setWin({ c: w.level, w: w.width })
  }

  /* ------------------------------------------------------------ derived */

  const levels = useMemo(() => [...(ann?.levels ?? [])].sort((a, b) => a.z - b.z), [ann])
  const here = useMemo(() => {
    if (!cursor || !levels.length) return null
    let best = levels[0]
    for (const l of levels) if (Math.abs(l.z - cursor[2]) < Math.abs(best.z - cursor[2])) best = l
    return { anchor: best, dz: cursor[2] - best.z, info: LEVELS.find((l) => l.id === best.id) }
  }, [cursor, levels])

  const highlight = useMemo(() => {
    if (!focus) return undefined
    const keys = focus.kind === 'level' ? LEVELS.find((l) => l.id === focus.id)?.structures ?? [] : CLINICAL.find((c) => c.id === focus.id)?.structures ?? []
    return new Set(keys)
  }, [focus])

  const quizActive = tab === 'quiz' && !!question && !answer

  /* ------------------------------------------------------------ actions */

  const goLevel = (id: string) => {
    const l = levels.find((x) => x.id === id)
    if (!l || !cursor) return
    setCursor([cursor[0], cursor[1], l.z]); setPlane('axial')
    if (!seriesId.startsWith('axial-5mm') && exam?.series.includes('axial-5mm-standard')) setSeriesId('axial-5mm-standard')
  }
  const goLandmark = (id: string) => {
    const lm = ann?.landmarks.find((x) => x.id === id)
    if (lm) { setCursor(lm.p); setSelected(id); setTab('structure') }
  }
  const applyWindow = (id: string) => {
    if (id === 'dicom' && meta) {
      const c = Array.isArray(meta.dicomWindowCenter) ? meta.dicomWindowCenter[0] : meta.dicomWindowCenter
      const w = Array.isArray(meta.dicomWindowWidth) ? meta.dicomWindowWidth[0] : meta.dicomWindowWidth
      if (c != null && w != null) setWin({ c, w })
      return
    }
    const w = WINDOWS.find((x) => x.id === id)
    if (w) setWin({ c: w.level, w: w.width })
  }

  const newQuestion = (kind: QuizKind = quizKind) => {
    if (!ann || !cursor) return
    const q = kind === 'level' ? levelQuestion(ann) : findQuestion(ann)
    setQuestion(q); setAnswer(null); setMeasure(null)
    if (q) {
      setPlane('axial')
      if (exam?.series.includes('axial-5mm-standard') && kind === 'level') setSeriesId('axial-5mm-standard')
      setCursor([cursor[0], cursor[1], q.z])
    }
  }
  const giveAnswer = (given: string, ok: boolean) => {
    setAnswer({ given, ok }); setScore((s) => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1 }))
  }
  const onPick = (h: Hover) => {
    if (tab === 'quiz' && question?.kind === 'find' && !answer && ann) {
      giveAnswer(h.landmark?.name ?? 'elsewhere', checkFind(ann, question.answer, h.p)); return
    }
    if (tab === 'quiz') return
    if (h.landmark) { setSelected(h.landmark.id); if (tab !== 'clinical' && tab !== 'exam') setTab('structure') }
  }

  // keyboard (external keyboards on iPad too)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as Partial<HTMLElement> | null
      if (t && typeof t.closest === 'function' && t.closest('input,select,textarea')) return
      const w = WINDOWS.find((x) => x.key === e.key)
      if (w) { setWin({ c: w.level, w: w.width }); return }
      if (!geo || !cursor) return
      const step = e.key === 'ArrowUp' || e.key === 'PageUp' ? 1 : e.key === 'ArrowDown' || e.key === 'PageDown' ? -1 : 0
      if (step) {
        e.preventDefault()
        const n = step * (e.key.startsWith('Page') ? 5 : 1)
        const idx = planeIndex(geo, plane, cursor)
        const c: Patient = [...cursor]
        if (plane === 'axial') c[2] = geo.z[Math.max(0, Math.min(geo.count - 1, idx + n))]
        else if (plane === 'coronal') c[1] = geo.y0 + Math.max(0, Math.min(geo.rows - 1, idx - n)) * geo.rowMm
        else c[0] = geo.x0 + Math.max(0, Math.min(geo.cols - 1, idx + n)) * geo.colMm
        setCursor(c)
      } else if (e.key === 'm') setMeasureMode((s) => !s)
      else if (e.key === 'l') setShowLabels((s) => !s)
      else if (e.key === 'Escape') { setFocus(null); setMeasure(null); setMeasureMode(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [geo, cursor, plane, setCursor])

  /* -------------------------------------------------------------- render */

  if (error) return <div className="ct-fatal"><h1>CT Anatomy</h1><p>{error}</p><p>The image data is kept in the separate <code>ct-anatomy-data</code> repository; serve its <code>viewer/</code> folder at <code>{DATA_BASE}</code> or pass <code>?data=…</code>.</p></div>
  if (!index || !exam || !meta || !geo || !store || !cursor || !ann) return <div className="ct-fatal"><p>Loading exam index…</p></div>

  const thumbs = PLANES.filter((pl) => pl !== plane)
  const viewProps = (pl: Plane, s: SeriesStore, g: Geo) => ({
    store: s, geo: g, plane: pl, cursor, onCursor: setCursor, center: win.c, width: win.w,
    onWindow: (c: number, w: number) => setWin({ c, w }), volumeReady: pl !== 'axial' && volumeReady,
    landmarks: ann.landmarks, levels: ann.levels, showLandmarks: showLandmarks && !quizActive, showLabels: showLabels && !quizActive,
    showCrosshair: crosshair && !quizActive, highlight, accent, version,
  })
  const thinStore = thinSeries ? storeFor(examId, thinSeries) : null
  const thinGeo = thinSeries ? geoOf(metas.get(key(examId, thinSeries))!) : null
  const mainStore = plane === 'axial' ? store : thinStore!
  const mainGeo = plane === 'axial' ? geo : thinGeo!

  return (
    <div className="ct-app" style={{ ['--exam' as string]: accent }}>
      <header className="ct-header">
        <button className="ct-icon ct-narrow-only" onClick={() => setSidebar((s) => !s)} aria-label="Show controls">☰</button>
        <div className="ct-brand"><strong>CT Anatomy</strong><span>Normal non-contrast head CT</span></div>
        <div className="ct-exams" role="radiogroup" aria-label="Examination">
          {index.exams.map((e) => (
            <button key={e.id} role="radio" aria-checked={e.id === examId} className={`ct-exam${e.id === examId ? ' is-on' : ''}`}
              style={{ ['--c' as string]: ACCENT[e.id] }} onClick={() => chooseExam(e.id)}>
              <b>{e.patientLabel}</b><span>{e.purpose}</span>
            </button>
          ))}
        </div>
      </header>
      <div className="ct-banner">
        <span className="ct-dot" /> <b>{exam.patientLabel}</b> · {exam.id} · {exam.title}
        <span className="ct-banner-note">{index.exams.length > 1 ? `Different person from ${index.exams.filter((e) => e.id !== examId).map((e) => e.patientLabel).join(', ')}` : ''}</span>
      </div>

      <div className="ct-body">
        {sidebar && <div className="ct-backdrop ct-narrow-only" onClick={() => setSidebar(false)} aria-hidden="true" />}
        <aside className={`ct-side${sidebar ? ' is-open' : ''}`} aria-label="Controls">
          <div className="ct-side-head ct-narrow-only"><b>Controls</b><button className="ct-icon" onClick={() => setSidebar(false)} aria-label="Close controls">✕</button></div>
          <section>
            <h3>Series</h3>
            <div className="ct-seg">
              {exam.series.map((s) => (
                <button key={s} className={s === seriesId ? 'is-on' : ''} onClick={() => { setSeriesId(s); if (s.startsWith('axial-5mm')) setPlane('axial') }}>
                  {seriesLabel(s)}
                </button>
              ))}
            </div>
            <p className="ct-hint">{meta.role}. {meta.convolutionKernel} kernel, {meta.sliceThickness} mm, {meta.count} images.</p>
          </section>
          <section>
            <h3>Window</h3>
            <div className="ct-chips">
              {WINDOWS.map((w) => (
                <button key={w.id} className={`ct-chip${win.c === w.level && win.w === w.width ? ' is-on' : ''}`} onClick={() => applyWindow(w.id)} title={w.use}>{w.name}</button>
              ))}
              {meta.dicomWindowCenter != null && <button className="ct-chip" onClick={() => applyWindow('dicom')} title="Window stored in the DICOM header">DICOM</button>}
            </div>
            <label className="ct-slider" htmlFor="wl-c"><span>Level</span>
              <input id="wl-c" type="range" min={-1000} max={1500} value={win.c} onChange={(e) => setWin({ ...win, c: Number(e.target.value) })} />
              <input className="ct-num" type="number" aria-label="Window level" value={win.c} onChange={(e) => setWin({ ...win, c: Number(e.target.value) })} />
            </label>
            <label className="ct-slider" htmlFor="wl-w"><span>Width</span>
              <input id="wl-w" type="range" min={1} max={4000} value={win.w} onChange={(e) => setWin({ ...win, w: Math.max(1, Number(e.target.value)) })} />
              <input className="ct-num" type="number" aria-label="Window width" value={win.w} min={1} onChange={(e) => setWin({ ...win, w: Math.max(1, Number(e.target.value)) })} />
            </label>
            <p className="ct-hint">DICOM linear VOI on Hounsfield units. Mouse: right-drag. Keys 1–5.</p>
          </section>
          <section>
            <h3>Zoom</h3>
            <div className="ct-seg">
              {ZOOMS.map((z) => <button key={String(z.id)} className={zoom === z.id ? 'is-on' : ''} onClick={() => setZoom(z.id)}>{z.label}</button>)}
            </div>
            <p className="ct-hint">100% = one CT pixel per screen point. Enlarged pixels are drawn as blocks, never interpolated. Pinch to zoom, two fingers to pan.</p>
          </section>
          <section>
            <h3>Plane</h3>
            <div className="ct-seg ct-cap">
              {PLANES.map((pl) => <button key={pl} className={plane === pl ? 'is-on' : ''} onClick={() => choosePlane(pl)}>{pl}</button>)}
            </div>
            {!volumeReady && <p className="ct-hint">Coronal and sagittal views are built from the {thinGeo?.count}-image thin series ({fmtMB((thinGeo?.cols ?? 0) * (thinGeo?.rows ?? 0) * (thinGeo?.count ?? 0) * 2)} in memory).</p>}
            {volumeReady && <button className="ct-chip" onClick={() => { thinStore?.dropVolume(); setVolKey(null); setPlane('axial') }}>Release 3-plane volume</button>}
          </section>
          <section>
            <h3>Overlays</h3>
            <label className="ct-check"><input type="checkbox" checked={showLandmarks} onChange={(e) => setShowLandmarks(e.target.checked)} /> Landmarks</label>
            <label className="ct-check"><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Labels</label>
            <label className="ct-check"><input type="checkbox" checked={crosshair} onChange={(e) => setCrosshair(e.target.checked)} /> Crosshair</label>
            <label className="ct-check"><input type="checkbox" checked={measureMode} onChange={(e) => setMeasureMode(e.target.checked)} /> Measure (drag)</label>
            {focus && <button className="ct-chip" onClick={() => setFocus(null)}>Clear highlight</button>}
          </section>
          <section>
            <h3>Levels</h3>
            <ol className="ct-levels">
              {[...levels].reverse().map((l) => (
                <li key={l.id}><button className={here?.anchor.id === l.id && !(quizActive && question?.kind === 'level') ? 'is-here' : ''} onClick={() => { goLevel(l.id); if (tab !== 'quiz') setTab('level') }}>
                  {LEVELS.find((x) => x.id === l.id)?.name ?? l.id}
                </button></li>
              ))}
            </ol>
          </section>
          <section>
            <h3>Offline</h3>
            <button className="ct-chip" disabled={!!offline.progress} onClick={async () => {
              try {
                const n = await saveOffline(index, [...metas.values()], (d, t) => setOffline((o) => ({ ...o, progress: `${fmtMB(d)} / ${fmtMB(t)}` })))
                setOffline({ ...(await offlineStatus(index, [...metas.values()])), progress: undefined })
                console.info(`[ct-anatomy] saved ${n} files for offline use`)
              } catch (e) { setOffline((o) => ({ ...o, progress: undefined })); alertText(String(e)) }
            }}>{offline.progress ? `Saving ${offline.progress}` : 'Save all exams for offline'}</button>
            <p className="ct-hint">{offline.total ? `${offline.cached} of ${offline.total} data files saved in this browser.` : ''}</p>
          </section>
        </aside>

        <main className="ct-main">
          <div className="ct-stage">
            <div className="ct-mainview">
              {plane !== 'axial' && !volumeReady ? (
                <div className="ct-need">{volProgress ? <>Building 3-plane volume… {volProgress}</> : <button className="ct-chip" onClick={() => void loadVolume()}>Load 3-plane volume</button>}</div>
              ) : (
                <Viewport {...viewProps(plane, mainStore, mainGeo)} zoom={zoom} measureMode={measureMode} measure={measure} onMeasure={setMeasure}
                  onHover={setHover} onPick={onPick} />
              )}
              {hover && !quizActive && (
                <div className="ct-readout">{hover.hu == null ? 'Outside scan field' : `${hover.hu} HU`}{hover.landmark ? ` · ${hover.landmark.name}` : ''}</div>
              )}
              {here?.info && !(quizActive && question?.kind === 'level') && (
                <div className="ct-here">≈ {here.info.name}{Math.abs(here.dz) > 2.5 ? ` (${here.dz > 0 ? '+' : ''}${here.dz.toFixed(0)} mm)` : ''}</div>
              )}
            </div>
            <SliceBar geo={mainGeo} plane={plane} cursor={cursor} onCursor={setCursor} />
          </div>
          <div className="ct-thumbs">
            {thumbs.map((pl) => (
              <button key={pl} className="ct-thumb" onClick={() => choosePlane(pl)} aria-label={`Show ${pl}`}>
                {pl !== 'axial' && !volumeReady
                  ? <span className="ct-thumb-empty">{pl}<small>{volProgress ? volProgress : 'tap to build'}</small></span>
                  : <Viewport {...viewProps(pl, pl === 'axial' ? store : thinStore!, pl === 'axial' ? geo : thinGeo!)} zoom="fit" compact />}
              </button>
            ))}
          </div>
          <div className="ct-credit">{index.source}. Licence: {index.license}.</div>
        </main>

        <aside className="ct-panel">
          <div className="ct-tabs" role="tablist">
            {(['level', 'structure', 'clinical', 'quiz', 'exam'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''}
                onClick={() => { setTab(t); if (t === 'quiz' && !question) newQuestion() }}>{t[0].toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
          <div className="ct-tabbody">
            {tab === 'level' && <LevelPanel info={here?.info} focused={focus?.kind === 'level' ? focus.id : null}
              onHighlight={(id) => setFocus(focus?.id === id ? null : { kind: 'level', id })}
              onSelect={(k) => { const lm = ann.landmarks.find((x) => baseId(x.id) === baseId(k)); if (lm) goLandmark(lm.id); else { setSelected(k); setTab('structure') } }} />}
            {tab === 'structure' && <StructurePanel id={selected} ann={ann} onLandmark={goLandmark} onLevel={goLevel} levels={levels.map((l) => l.id)} />}
            {tab === 'clinical' && <ClinicalPanel id={clinicalId} onTopic={setClinicalId} focused={focus?.kind === 'clinical' ? focus.id : null}
              onFocus={(t) => { setFocus(focus?.id === t.id ? null : { kind: 'clinical', id: t.id }); applyWindow(t.window) }} onLevel={goLevel} levels={levels.map((l) => l.id)} />}
            {tab === 'quiz' && <QuizPanel kind={quizKind} setKind={(k) => { setQuizKind(k); newQuestion(k) }} q={question} answer={answer} score={score}
              onAnswer={(id) => question && !answer && giveAnswer(id, id === question.answer)} onNext={() => newQuestion()} />}
            {tab === 'exam' && <ExamPanel exam={exam} metas={exam.series.map((s) => metas.get(key(examId, s))!)} stores={stores.current} ann={ann} index={index} />}
          </div>
        </aside>
      </div>
    </div>
  )
}

function alertText(t: string) { console.error(t) }

/* -------------------------------------------------------------- slice bar */

function SliceBar(p: { geo: Geo; plane: Plane; cursor: Patient; onCursor: (c: Patient) => void }) {
  const { geo, plane, cursor } = p
  const n = planeCount(geo, plane)
  const idx = planeIndex(geo, plane, cursor)
  const toSlider = (i: number) => (plane === 'coronal' ? n - 1 - i : i)
  const set = (sv: number) => {
    const i = plane === 'coronal' ? n - 1 - sv : sv
    const c: Patient = [...cursor]
    if (plane === 'axial') c[2] = geo.z[i]
    else if (plane === 'coronal') c[1] = geo.y0 + i * geo.rowMm
    else c[0] = geo.x0 + i * geo.colMm
    p.onCursor(c)
  }
  const [lo, hi] = plane === 'axial' ? ['Inf', 'Sup'] : plane === 'coronal' ? ['Post', 'Ant'] : ['R', 'L']
  const step = (d: number) => set(Math.max(0, Math.min(n - 1, toSlider(idx) + d)))
  return (
    <div className="ct-slicebar">
      <button onClick={() => step(-1)} aria-label="Previous image">▼</button>
      <span>{lo}</span>
      <input type="range" min={0} max={n - 1} step={1} value={toSlider(idx)} onChange={(e) => set(Number(e.target.value))} aria-label="Image" />
      <span>{hi}</span>
      <button onClick={() => step(1)} aria-label="Next image">▲</button>
    </div>
  )
}

/* ----------------------------------------------------------------- panels */

function LevelPanel(p: { info?: (typeof LEVELS)[number]; focused: string | null; onHighlight: (id: string) => void; onSelect: (k: string) => void }) {
  const l = p.info
  if (!l) return <p className="ct-hint">Scroll the axial images to identify the level.</p>
  const arteries = LEVEL_ARTERIES[l.id] ?? []
  return (
    <div className="ct-card">
      <h2>{l.name}</h2>
      <h4>How to recognise it</h4><p>{l.recognise}</p>
      <h4>Identify on this image</h4>
      <ul>{l.identify.map((s) => <li key={s}>{s}</li>)}</ul>
      <div className="ct-chips">
        {l.structures.filter((k, i, a) => STRUCTURES[k] && a.findIndex((x) => STRUCTURES[x]?.name === STRUCTURES[k].name) === i).map((k) => (
          <button key={k} className="ct-chip" onClick={() => p.onSelect(k)}>{STRUCTURES[k].name}</button>
        ))}
      </div>
      {arteries.length > 0 && (<>
        <h4>Arteries at this level (non-contrast)</h4>
        <div className="ct-chips">{arteries.map((k) => <button key={k} className="ct-chip" onClick={() => p.onSelect(k)}>{STRUCTURES[k].name}</button>)}</div>
      </>)}
      <button className={`ct-chip ct-action${p.focused === l.id ? ' is-on' : ''}`} onClick={() => p.onHighlight(l.id)}>
        {p.focused === l.id ? 'Clear highlight' : 'Highlight this level’s landmarks'}
      </button>
      <h4>Clinical relevance</h4><p>{l.clinical}</p>
    </div>
  )
}

function StructurePanel(p: { id: string | null; ann: Annotations; onLandmark: (id: string) => void; onLevel: (id: string) => void; levels: string[] }) {
  const s = p.id ? STRUCTURES[p.id] : null
  return (
    <div className="ct-card">
      {s ? (<>
        <h2>{s.name}</h2>
        <h4>On CT</h4><p>{s.ct}</p>
        <h4>How to find it</h4><p>{s.find}</p>
        <h4>Clinical</h4><p>{s.clinical}</p>
        <div className="ct-chips">
          {s.levels.filter((l) => p.levels.includes(l)).map((l) => <button key={l} className="ct-chip" onClick={() => p.onLevel(l)}>Go to {LEVELS.find((x) => x.id === l)?.short}</button>)}
        </div>
        {s.atlas.length > 0 && (<>
          <h4>From the NeuroAxis atlas</h4>
          {s.atlas.map((id) => { const r = getAtlasRecord(id); return r ? (
            <details key={id} className="ct-atlas"><summary>{r.name}</summary><p>{r.function}</p>{r.bloodSupply && <p><b>Blood supply:</b> {r.bloodSupply}</p>}</details>
          ) : null })}
        </>)}
      </>) : <p className="ct-hint">Tap a yellow landmark on the image, or choose one below.</p>}
      <h4>Landmarks marked on this exam</h4>
      <div className="ct-chips">
        {p.ann.landmarks.map((lm) => <button key={lm.id} className={`ct-chip${lm.id === p.id ? ' is-on' : ''}`} onClick={() => p.onLandmark(lm.id)}>{lm.name}</button>)}
      </div>
      <p className="ct-hint">{p.ann.method}</p>
    </div>
  )
}

function ClinicalPanel(p: { id: string; onTopic: (id: string) => void; focused: string | null; onFocus: (t: ClinicalTopic) => void; onLevel: (id: string) => void; levels: string[] }) {
  const t = CLINICAL.find((c) => c.id === p.id) ?? CLINICAL[0]
  const groups = [...new Set(CLINICAL.map((c) => c.group))]
  return (
    <div className="ct-card">
      <select className="ct-select" value={t.id} onChange={(e) => p.onTopic(e.target.value)} aria-label="Clinical topic">
        {groups.map((g) => <optgroup key={g} label={g}>{CLINICAL.filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</optgroup>)}
      </select>
      <h2>{t.title}</h2>
      <h4>Where</h4><p>{t.where}</p>
      <h4>What it looks like</h4><p>{t.looks}</p>
      <h4>Check on this normal scan</h4><p>{t.normalCheck}</p>
      <div className="ct-chips">
        <button className={`ct-chip ct-action${p.focused === t.id ? ' is-on' : ''}`} onClick={() => p.onFocus(t)}>{p.focused === t.id ? 'Clear highlight' : `Use ${WINDOWS.find((w) => w.id === t.window)?.name} window + highlight`}</button>
        {t.levels.filter((l) => p.levels.includes(l)).map((l) => <button key={l} className="ct-chip" onClick={() => p.onLevel(l)}>Go to {LEVELS.find((x) => x.id === l)?.short}</button>)}
      </div>
      <p className="ct-hint">Educational summary of typical locations on normal anatomy, not a diagnostic rule. No pathology images are shown.</p>
    </div>
  )
}

function QuizPanel(p: { kind: QuizKind; setKind: (k: QuizKind) => void; q: Question | null; answer: { given: string; ok: boolean } | null; score: { right: number; total: number }; onAnswer: (id: string) => void; onNext: () => void }) {
  const { q } = p
  return (
    <div className="ct-card">
      <div className="ct-seg">
        <button className={p.kind === 'level' ? 'is-on' : ''} onClick={() => p.setKind('level')}>Name the level</button>
        <button className={p.kind === 'find' ? 'is-on' : ''} onClick={() => p.setKind('find')}>Find the landmark</button>
      </div>
      <p className="ct-hint">Score {p.score.right}/{p.score.total}</p>
      {q && (<>
        <h2>{q.prompt}</h2>
        {q.options && (
          <div className="ct-options">
            {q.options.map((o) => {
              const cls = p.answer ? (o.id === q.answer ? ' is-right' : o.id === p.answer.given ? ' is-wrong' : '') : ''
              return <button key={o.id} className={`ct-option${cls}`} disabled={!!p.answer} onClick={() => p.onAnswer(o.id)}>{o.label}</button>
            })}
          </div>
        )}
        {q.kind === 'find' && !p.answer && <p className="ct-hint">Scroll if needed, then tap the structure on the image.</p>}
        {p.answer && <div className={`ct-result${p.answer.ok ? ' is-right' : ' is-wrong'}`}><b>{p.answer.ok ? 'Correct.' : 'Not quite.'}</b> {q.explain}</div>}
        <button className="ct-chip ct-action" onClick={p.onNext}>{p.answer ? 'Next question' : 'Skip'}</button>
      </>)}
    </div>
  )
}

function ExamPanel(p: { exam: ExamInfo; metas: SeriesMeta[]; stores: Map<string, SeriesStore>; ann: Annotations; index: DataIndex }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t) }, [])
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
  return (
    <div className="ct-card">
      <h2>{p.exam.patientLabel}: {p.exam.title}</h2>
      <p>{p.exam.id}. {p.exam.purpose}. A different person from the other examination; positions are never shared between them.</p>
      {p.metas.map((m) => {
        const s = p.stores.get(`${m.study}/${m.series}`)
        return (
          <div key={m.series} className="ct-spec">
            <h4>{seriesLabel(m.series)}: “{m.sourceSeriesDescription}”</h4>
            <dl>
              <dt>Images</dt><dd>{m.count} × {m.columns}×{m.rows}</dd>
              <dt>Pixel</dt><dd>{m.pixelSpacing[1].toFixed(3)} × {m.pixelSpacing[0].toFixed(3)} mm</dd>
              <dt>Slice</dt><dd>{m.sliceThickness} mm thick</dd>
              <dt>Kernel</dt><dd>{m.convolutionKernel}, {m.kvp} kV, {m.tubeCurrent_mA} mA</dd>
              <dt>Data</dt><dd>signed {m.bitsStored}-bit, HU = stored × {m.rescaleSlope} + ({m.rescaleIntercept}); padding {m.pixelPaddingValue}</dd>
              <dt>Download</dt><dd>{fmtMB(m.compressedBytes)} in {m.chunks.length} lossless chunks</dd>
              {s && <><dt>In memory</dt><dd>{s.stats.volumeLoaded ? `full volume ${fmtMB(s.stats.volumeBytes)}` : `${s.stats.decodedSlices} decoded images`} · fetched {fmtMB(s.stats.bytesFetched)} · avg decode {s.stats.decodeCount ? (s.stats.decodeMsTotal / s.stats.decodeCount).toFixed(1) : '–'} ms</dd></>}
            </dl>
          </div>
        )
      })}
      {mem && <p className="ct-hint">JS heap in use: {fmtMB(mem.usedJSHeapSize)}</p>}
      <h4>Source and licence</h4>
      <p>{p.index.source}. {p.index.license}. {p.index.licenseUrl && <a href={p.index.licenseUrl} target="_blank" rel="noreferrer">Dataset page</a>}</p>
      <p className="ct-hint">Pixel values are the original DICOM stored values, losslessly compressed and verified value-for-value against the source DICOM. Overlays are drawn on a separate layer.</p>
      <h4>Annotations</h4><p className="ct-hint">{p.ann.method}</p>
    </div>
  )
}
