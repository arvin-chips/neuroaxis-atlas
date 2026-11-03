import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAtlasRecord } from './atlas'
import {
  CLINICAL, DEFAULT_WINDOW, LEVELS, STRUCTURES, WINDOWS,
  type ClinicalTopic, type Plane,
} from './content'
import { SliceView, type HoverInfo, type MeasureLine, type OverlayState } from './SliceView'
import {
  clampVoxel, EMBEDDED, labelValueByKey, loadCase, loadIndex, nearestLevel, planeGeom, sliceOf,
  type CaseIndexEntry, type CaseMeta, type Landmark, type LevelAnchor, type Volume, type Voxel,
} from './volume'
import { makeQuestion, type Question, type QuizKind } from './quiz'
import { offlineStatus, registerServiceWorker, saveOffline } from './offline'

type Tab = 'level' | 'structure' | 'clinical' | 'quiz' | 'data'
const PLANES: Plane[] = ['axial', 'coronal', 'sagittal']
const ATLAS_URL = import.meta.env.BASE_URL

const baseKey = (id: string) => id.replace(/-(r|l)$/, '')

function storageGet<T>(k: string): T | null {
  try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as T) : null } catch { return null }
}
function storageSet(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

export default function CtApp() {
  const [index, setIndex] = useState<CaseIndexEntry[]>([])
  const [caseId, setCaseId] = useState<string | null>(null)
  const [vol, setVol] = useState<Volume | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [cursor, setCursor] = useState<Voxel>([0, 0, 0])
  const [mainPlane, setMainPlane] = useState<Plane>('axial')
  const [win, setWin] = useState({ level: DEFAULT_WINDOW.level, width: DEFAULT_WINDOW.width })
  const [tab, setTab] = useState<Tab>('level')
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [measureMode, setMeasureMode] = useState(false)
  const [measure, setMeasure] = useState<MeasureLine | null>(null)
  const [crosshair, setCrosshair] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [showLabels, setShowLabels] = useState(true)
  const [opacity, setOpacity] = useState(0.35)
  const [outline, setOutline] = useState(false)
  const [text, setText] = useState(true)
  const [landmarks, setLandmarks] = useState(true)
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const [isolate, setIsolate] = useState<number | null>(null)
  const [focus, setFocus] = useState<{ kind: 'level' | 'clinical'; id: string } | null>(null)
  const [clinicalId, setClinicalId] = useState<string>(CLINICAL[0].id)

  // quiz
  const [quizKind, setQuizKind] = useState<QuizKind>('level')
  const [question, setQuestion] = useState<Question | null>(null)
  const [answer, setAnswer] = useState<{ given: string; ok: boolean } | null>(null)
  const [score, setScore] = useState({ right: 0, total: 0 })

  // author overrides (per case, local only)
  const [authorLevels, setAuthorLevels] = useState<LevelAnchor[] | null>(null)
  const [authorLandmarks, setAuthorLandmarks] = useState<Landmark[] | null>(null)
  const [offline, setOffline] = useState<{ cached: number; progress?: string }>({ cached: 0 })

  /* ------------------------------------------------------------ loading */

  useEffect(() => {
    registerServiceWorker()
    offlineStatus().then((n) => setOffline({ cached: n }))
    loadIndex()
      .then((cases) => {
        setIndex(cases)
        const want = new URLSearchParams(location.search).get('case')
        setCaseId(cases.find((c) => c.id === want)?.id ?? cases[0]?.id ?? null)
      })
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    if (!caseId) return
    setLoading(true)
    setError(null)
    loadCase(caseId)
      .then((v) => {
        const lv = storageGet<LevelAnchor[]>(`ct-anatomy:levels:${caseId}`)
        const lm = storageGet<Landmark[]>(`ct-anatomy:landmarks:${caseId}`)
        setAuthorLevels(lv)
        setAuthorLandmarks(lm)
        setVol(v)
        const mid = v.meta.levels.find((l) => l.id === 'third-ventricle')?.z ?? Math.floor(v.nz / 2)
        setCursor([Math.floor(v.nx / 2), Math.floor(v.ny / 2), mid])
        setHidden(new Set()); setIsolate(null); setFocus(null); setSelected(null)
        setQuestion(null); setAnswer(null); setMeasure(null)
        const cal = v.meta.intensity?.calibrated !== false
        if (!cal) setWin({ level: DEFAULT_WINDOW.level, width: DEFAULT_WINDOW.width })
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [caseId])

  // effective case (author overrides applied)
  const v: Volume | null = useMemo(() => {
    if (!vol) return null
    if (!authorLevels && !authorLandmarks) return vol
    return { ...vol, meta: { ...vol.meta, levels: authorLevels ?? vol.meta.levels, landmarks: authorLandmarks ?? vol.meta.landmarks } }
  }, [vol, authorLevels, authorLandmarks])

  const calibrated = v?.meta.intensity?.calibrated !== false
  const hasLabels = !!v?.labels

  /* ------------------------------------------------------------ derived */

  const levelsSorted = useMemo(() => (v ? [...v.meta.levels].sort((a, b) => a.z - b.z) : []), [v])
  const here = v ? nearestLevel(v.meta.levels, cursor[2]) : null
  const hereInfo = here ? LEVELS.find((l) => l.id === here.anchor.id) : undefined

  const emphasisKeys = useMemo(() => {
    if (!focus) return [] as string[]
    if (focus.kind === 'level') return LEVELS.find((l) => l.id === focus.id)?.structures ?? []
    return CLINICAL.find((c) => c.id === focus.id)?.structures ?? []
  }, [focus])

  const overlay: OverlayState = useMemo(() => {
    const emphasis = new Set<number>()
    const emphasisLandmarks = new Set<string>()
    if (v) for (const k of emphasisKeys) {
      const val = labelValueByKey(v, k)
      if (val != null) emphasis.add(val)
      else emphasisLandmarks.add(k)
    }
    return {
      show: showLabels && hasLabels, opacity, outline, text, hidden, isolate,
      emphasis, landmarks, emphasisLandmarks: focus ? emphasisLandmarks : new Set(),
    }
  }, [v, showLabels, hasLabels, opacity, outline, text, hidden, isolate, emphasisKeys, landmarks, focus])

  /* ---------------------------------------------------------- actions */

  const goLevel = useCallback((id: string) => {
    if (!v) return
    const a = v.meta.levels.find((l) => l.id === id)
    if (!a) return
    setCursor((c) => clampVoxel(v, [c[0], c[1], a.z]))
    setMainPlane('axial')
  }, [v])

  const applyWindow = (id: string) => {
    const w = WINDOWS.find((x) => x.id === id)
    if (w) setWin({ level: w.level, width: w.width })
  }

  const nextQuestion = useCallback((kind: QuizKind = quizKind) => {
    if (!v) return
    const q = makeQuestion(v, kind)
    setQuestion(q)
    setAnswer(null)
    setMeasure(null)
    if (q) { setCursor(q.cursor); setMainPlane('axial') }
  }, [v, quizKind])

  const giveAnswer = (given: string) => {
    if (!question || answer) return
    const ok = baseKey(given) === baseKey(question.answer)
    setAnswer({ given, ok })
    setScore((s) => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1 }))
  }

  const onPick = (h: HoverInfo) => {
    if (!v) return
    if (tab === 'quiz' && question?.kind === 'find' && !answer) {
      const key = h.landmark ?? (h.label ? v.labelDefs.get(h.label)?.key ?? '' : '')
      giveAnswer(key || '(nothing)')
      return
    }
    if (tab === 'quiz') return
    const key = h.landmark ?? (h.label ? v.labelDefs.get(h.label)?.key : null)
    if (key) { setSelected(key); if (tab !== 'clinical' && tab !== 'data') setTab('structure') }
  }

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!v || (e.target as HTMLElement)?.closest('input,select,textarea')) return
      const w = WINDOWS.find((x) => x.key === e.key)
      if (w) { setWin({ level: w.level, width: w.width }); return }
      const axis = mainPlane === 'axial' ? 2 : mainPlane === 'coronal' ? 1 : 0
      const step = e.key === 'ArrowUp' || e.key === 'PageUp' ? 1 : e.key === 'ArrowDown' || e.key === 'PageDown' ? -1 : 0
      if (step) {
        e.preventDefault()
        const n = (e.key.startsWith('Page') ? 5 : 1) * step * (mainPlane === 'coronal' ? -1 : 1)
        setCursor((c) => { const d: Voxel = [...c]; d[axis] += n; return clampVoxel(v, d) })
      } else if (e.key === 'l' || e.key === 'L') setShowLabels((s) => !s)
      else if (e.key === 't' || e.key === 'T') setText((s) => !s)
      else if (e.key === 'm' || e.key === 'M') setMeasureMode((s) => !s)
      else if (e.key === 'c' || e.key === 'C') setCrosshair((s) => !s)
      else if (e.key === 'a') setMainPlane('axial')
      else if (e.key === 's') setMainPlane('sagittal')
      else if (e.key === 'o') setMainPlane('coronal')
      else if (e.key === 'Escape') { setIsolate(null); setFocus(null); setMeasure(null); setMeasureMode(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [v, mainPlane])

  /* -------------------------------------------------------------- views */

  const quizActive = tab === 'quiz' && !!question
  const hideText = quizActive && !answer
  const viewProps = (plane: Plane) => ({
    vol: v!, plane, cursor, onCursor: setCursor, win, onWindow: setWin,
    overlay: quizActive ? { ...overlay, show: false, landmarks: !!answer && overlay.landmarks } : overlay,
    onHover: setHover, onPick, measureMode, measure, onMeasure: setMeasure,
    hideText, quizOutline: quizActive ? question?.outlineLabel ?? null : null, showCrosshair: crosshair && !quizActive,
  })

  const hoverText = (() => {
    if (!v || !hover) return null
    const parts = [`HU ${hover.hu}`]
    if (!calibrated && (hover.hu <= (v.meta.intensity?.validRangeHU?.[0] ?? -1e9) || hover.hu >= (v.meta.intensity?.validRangeHU?.[1] ?? 1e9))) parts[0] += ' (clipped)'
    if (!hideText) {
      if (hover.label) parts.push(v.labelDefs.get(hover.label)?.name ?? '')
      if (hover.landmark) parts.push(v.meta.landmarks.find((l) => l.id === hover.landmark)?.name ?? '')
    }
    return parts.join(' · ')
  })()

  /* ------------------------------------------------------------- render */

  return (
    <div className="ct-app">
      <header className="ct-header">
        <button className="ct-icon-btn ct-only-narrow" onClick={() => setSidebarOpen((s) => !s)} aria-label="Toggle controls">☰</button>
        <div className="ct-brand">
          <strong>CT Anatomy</strong>
          <span className="ct-sub">Normal head CT · foramen magnum → vertex</span>
        </div>
        <select className="ct-case" value={caseId ?? ''} onChange={(e) => setCaseId(e.target.value)} aria-label="Case">
          {index.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        {!EMBEDDED && (
          <nav className="ct-header-links">
            <a href={ATLAS_URL}>3D atlas ↗</a>
          </nav>
        )}
      </header>

      {error && <div className="ct-error">Could not load: {error}</div>}

      <div className="ct-body">
        <aside className={`ct-sidebar${sidebarOpen ? ' is-open' : ''}`}>
          <section>
            <h3>Window</h3>
            <div className="ct-chips">
              {WINDOWS.map((w) => {
                const disabled = !calibrated && w.id !== 'brain' && w.id !== 'stroke'
                const on = win.level === w.level && win.width === w.width
                return (
                  <button key={w.id} className={`ct-chip${on ? ' is-on' : ''}`} disabled={disabled}
                    title={disabled ? 'This case is stored pre-windowed (−20…100 HU); this window needs a calibrated volume.' : `${w.use} (key ${w.key})`}
                    onClick={() => applyWindow(w.id)}>{w.name}</button>
                )
              })}
            </div>
            <label className="ct-range">Level <input type="range" min={-200} max={1000} step={1} value={win.level} onChange={(e) => setWin((w) => ({ ...w, level: Number(e.target.value) }))} /> <span className="ct-num">{win.level}</span></label>
            <label className="ct-range">Width <input type="range" min={1} max={3000} step={1} value={win.width} onChange={(e) => setWin((w) => ({ ...w, width: Number(e.target.value) }))} /> <span className="ct-num">{win.width}</span></label>
            <p className="ct-hint">Touch: swipe up/down on the image to scroll slices, tap to place the crosshair and name what is under it. Mouse: wheel scrolls, right-drag adjusts the window.</p>
            {!calibrated && <p className="ct-warn">This case only holds −20…100 HU. Bone, subdural and soft-tissue windows need a calibrated case built from DICOM.</p>}
          </section>

          <section>
            <h3>Planes</h3>
            <div className="ct-chips">
              {PLANES.map((pl) => (
                <button key={pl} className={`ct-chip ct-cap${mainPlane === pl ? ' is-on' : ''}`} onClick={() => setMainPlane(pl)}>{pl}</button>
              ))}
            </div>
            <label className="ct-check"><input type="checkbox" checked={crosshair} onChange={(e) => setCrosshair(e.target.checked)} /> Crosshair (C)</label>
            <label className="ct-check"><input type="checkbox" checked={measureMode} onChange={(e) => setMeasureMode(e.target.checked)} /> Measure (M)</label>
          </section>

          <section>
            <h3>Levels</h3>
            {levelsSorted.length === 0 && <p className="ct-hint">No level anchors in this case yet — add them in the Data tab.</p>}
            <ol className="ct-levels">
              {[...levelsSorted].reverse().map((l) => {
                const info = LEVELS.find((x) => x.id === l.id)
                return (
                  <li key={l.id}>
                    <button className={here?.anchor.id === l.id && !(quizActive && !answer) ? 'is-here' : ''} onClick={() => { goLevel(l.id); if (tab !== 'quiz') setTab('level') }}>
                      {info?.name ?? l.id}{l.source === 'auto' ? ' *' : ''}
                    </button>
                  </li>
                )
              })}
            </ol>
            {levelsSorted.some((l) => l.source === 'auto') && <p className="ct-hint">* auto-suggested from segmentation</p>}
          </section>

          <section>
            <h3>Structures</h3>
            {!hasLabels && <p className="ct-hint">This case has no segmentation. Build a case with TotalSegmentator (<code>scripts/ct-anatomy/build_case.py --segment</code>) to colour and isolate structures. Landmarks are still shown.</p>}
            {hasLabels && (
              <>
                <label className="ct-check"><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Colour overlay (L)</label>
                <label className="ct-check"><input type="checkbox" checked={text} onChange={(e) => setText(e.target.checked)} /> Text labels (T)</label>
                <label className="ct-check"><input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} /> Outline only</label>
                <label className="ct-range">Opacity <input type="range" min={0.1} max={0.9} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} /></label>
                <ul className="ct-structs">
                  {[...v!.labelDefs.entries()].map(([val, d]) => (
                    <li key={val} className={isolate === val ? 'is-iso' : ''}>
                      <input type="checkbox" checked={!hidden.has(val)} aria-label={`Show ${d.name}`}
                        onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(val)) n.delete(val); else n.add(val); return n })} />
                      <span className="ct-swatch" style={{ background: d.color }} />
                      <button className="ct-link" onClick={() => { setSelected(d.key); setTab('structure') }}>{d.name}</button>
                      <button className="ct-mini" onClick={() => setIsolate(isolate === val ? null : val)} title="Isolate">{isolate === val ? '×' : 'iso'}</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <label className="ct-check"><input type="checkbox" checked={landmarks} onChange={(e) => setLandmarks(e.target.checked)} /> Landmarks</label>
            {(focus || isolate != null) && (
              <button className="ct-chip" onClick={() => { setFocus(null); setIsolate(null) }}>Clear highlight (Esc)</button>
            )}
          </section>

          {EMBEDDED ? (
            <section className="ct-offline">
              <h3>Offline</h3>
              <p className="ct-hint">This file contains everything (scan, labels, teaching text). It works with no internet — keep it in the Files app.</p>
            </section>
          ) : (
          <section className="ct-offline">
            <h3>Offline</h3>
            <button className="ct-chip" disabled={!v || !!offline.progress}
              onClick={async () => {
                if (!v) return
                try {
                  const metas: CaseMeta[] = []
                  for (const c of index) metas.push(c.id === v.meta.id ? v.meta : (await (await fetch(`${import.meta.env.BASE_URL}ct-cases/${c.id}/case.json`)).json()))
                  const n = await saveOffline(metas, (d, t) => setOffline((o) => ({ ...o, progress: `${d}/${t}` })))
                  setOffline({ cached: n })
                } catch (e) { setOffline({ cached: 0, progress: undefined }); setError(String(e)) }
              }}>
              {offline.progress ? `Saving ${offline.progress}…` : 'Save all cases offline'}
            </button>
            <p className="ct-hint">{offline.cached ? `${offline.cached} files cached in this browser.` : 'Nothing cached yet.'}</p>
          </section>
          )}
        </aside>

        <main className="ct-main">
          {loading && <div className="ct-loading">Loading scan…</div>}
          {v && (
            <div className="ct-viewer">
              <div className="ct-main-view">
                <SliceView key={`main-${mainPlane}`} {...viewProps(mainPlane)} active />
                {hoverText && <div className="ct-readout">{hoverText}</div>}
                <SliceBar vol={v} plane={mainPlane} cursor={cursor} onCursor={setCursor} />
                {here && hereInfo && !(quizActive && question?.kind === 'level' && !answer) && (
                  <div className="ct-here">≈ {hereInfo.name}{Math.abs(here.dz) > 2 ? ` (${here.dz > 0 ? '+' : ''}${(here.dz * v.sz).toFixed(0)} mm)` : ''}</div>
                )}
              </div>
              <div className="ct-thumbs">
                {PLANES.filter((pl) => pl !== mainPlane).map((pl) => (
                  <button key={pl} className="ct-thumb" onClick={() => setMainPlane(pl)} aria-label={`Show ${pl} as main view`}>
                    <SliceView {...viewProps(pl)} compact />
                  </button>
                ))}
              </div>
            </div>
          )}
          {v && <div className="ct-credit">{v.meta.credit || v.meta.source} · {v.meta.license}</div>}
        </main>

        <aside className="ct-panel">
          <div className="ct-tabs" role="tablist">
            {(['level', 'structure', 'clinical', 'quiz', 'data'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''}
                onClick={() => { setTab(t); if (t === 'quiz' && !question) nextQuestion() }}>
                {t === 'level' ? 'Level' : t === 'structure' ? 'Structure' : t === 'clinical' ? 'Clinical' : t === 'quiz' ? 'Quiz' : 'Data'}
              </button>
            ))}
          </div>
          <div className="ct-tab-body">
            {tab === 'level' && <LevelPanel here={hereInfo} onHighlight={(id) => setFocus(focus?.id === id ? null : { kind: 'level', id })} focused={focus?.kind === 'level' ? focus.id : null}
              onSelect={(k) => { setSelected(k); setTab('structure') }} />}
            {tab === 'structure' && <StructurePanel id={selected} vol={v} onIsolate={(val) => setIsolate(val)} onLevel={goLevel} />}
            {tab === 'clinical' && <ClinicalPanel topicId={clinicalId} onTopic={setClinicalId} vol={v}
              focused={focus?.kind === 'clinical' ? focus.id : null}
              onFocus={(t) => { setFocus(focus?.id === t.id ? null : { kind: 'clinical', id: t.id }); applyWindowSafe(t) }}
              onLevel={goLevel} />}
            {tab === 'quiz' && v && (
              <QuizPanel vol={v} kind={quizKind} setKind={(k) => { setQuizKind(k); nextQuestion(k) }} question={question}
                answer={answer} score={score} onAnswer={giveAnswer} onNext={() => nextQuestion()} />
            )}
            {tab === 'data' && v && (
              <DataPanel vol={v} cursor={cursor} levels={v.meta.levels} landmarks={v.meta.landmarks}
                edited={!!(authorLevels || authorLandmarks)}
                setLevels={(l) => { setAuthorLevels(l); storageSet(`ct-anatomy:levels:${v.meta.id}`, l) }}
                setLandmarks={(l) => { setAuthorLandmarks(l); storageSet(`ct-anatomy:landmarks:${v.meta.id}`, l) }}
                reset={() => { setAuthorLevels(null); setAuthorLandmarks(null); try { localStorage.removeItem(`ct-anatomy:levels:${v.meta.id}`); localStorage.removeItem(`ct-anatomy:landmarks:${v.meta.id}`) } catch { /* */ } }} />
            )}
          </div>
        </aside>
      </div>
    </div>
  )

  function applyWindowSafe(t: ClinicalTopic) {
    if (!calibrated && t.window !== 'brain' && t.window !== 'stroke') return
    applyWindow(t.window)
  }
}

/* ================================================================ panels */

function LevelPanel(p: { here?: (typeof LEVELS)[number]; focused: string | null; onHighlight: (id: string) => void; onSelect: (k: string) => void }) {
  const l = p.here
  if (!l) return <p className="ct-hint">Scroll the axial view to identify the level.</p>
  return (
    <div className="ct-card">
      <h2>{l.name}</h2>
      <h4>How to recognise it</h4>
      <p>{l.recognise}</p>
      <h4>Identify on this slice</h4>
      <ul>{l.identify.map((s) => <li key={s}>{s}</li>)}</ul>
      <div className="ct-chips">
        {l.structures.filter((k, i, a) => STRUCTURES[k] && a.findIndex((x) => STRUCTURES[x]?.name === STRUCTURES[k].name) === i).map((k) => (
          <button key={k} className="ct-chip" onClick={() => p.onSelect(k)}>{STRUCTURES[k].name}</button>
        ))}
      </div>
      <button className={`ct-chip ct-action${p.focused === l.id ? ' is-on' : ''}`} onClick={() => p.onHighlight(l.id)}>
        {p.focused === l.id ? 'Show all structures' : 'Highlight this level’s structures'}
      </button>
      <h4>Clinical relevance</h4>
      <p>{l.clinical}</p>
    </div>
  )
}

function StructurePanel(p: { id: string | null; vol: Volume | null; onIsolate: (v: number | null) => void; onLevel: (id: string) => void }) {
  if (!p.id) return <p className="ct-hint">Click a structure or landmark on the scan, or choose one from the list.</p>
  const s = STRUCTURES[p.id]
  if (!s) return <p className="ct-hint">No teaching entry for “{p.id}”.</p>
  const val = p.vol ? labelValueByKey(p.vol, p.id) : null
  return (
    <div className="ct-card">
      <h2>{s.name}</h2>
      <h4>On CT</h4><p>{s.ct}</p>
      <h4>How to find it</h4><p>{s.find}</p>
      <h4>Clinical</h4><p>{s.clinical}</p>
      <div className="ct-chips">
        {val != null && <button className="ct-chip ct-action" onClick={() => p.onIsolate(val)}>Isolate on scan</button>}
        {s.levels.filter((l) => p.vol?.meta.levels.some((x) => x.id === l)).map((l) => (
          <button key={l} className="ct-chip" onClick={() => p.onLevel(l)}>Go to {LEVELS.find((x) => x.id === l)?.short}</button>
        ))}
      </div>
      {s.atlas.length > 0 && (
        <>
          <h4>From the NeuroAxis atlas</h4>
          {s.atlas.map((id) => {
            const r = getAtlasRecord(id)
            if (!r) return null
            return (
              <details key={id} className="ct-atlas">
                <summary>{r.name}</summary>
                <p>{r.function}</p>
                {r.bloodSupply && <p><strong>Blood supply:</strong> {r.bloodSupply}</p>}
                {!EMBEDDED && <a href={`${ATLAS_URL}?select=${encodeURIComponent(id)}`}>Open in 3D atlas ↗</a>}
              </details>
            )
          })}
        </>
      )}
    </div>
  )
}

function ClinicalPanel(p: { topicId: string; onTopic: (id: string) => void; vol: Volume | null; focused: string | null; onFocus: (t: ClinicalTopic) => void; onLevel: (id: string) => void }) {
  const t = CLINICAL.find((c) => c.id === p.topicId) ?? CLINICAL[0]
  const groups = [...new Set(CLINICAL.map((c) => c.group))]
  return (
    <div className="ct-card">
      <select value={t.id} onChange={(e) => p.onTopic(e.target.value)} className="ct-select" aria-label="Clinical topic">
        {groups.map((g) => (
          <optgroup key={g} label={g}>{CLINICAL.filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</optgroup>
        ))}
      </select>
      <h2>{t.title}</h2>
      <h4>Where</h4><p>{t.where}</p>
      <h4>What it looks like</h4><p>{t.looks}</p>
      <h4>Check on this normal scan</h4><p>{t.normalCheck}</p>
      <div className="ct-chips">
        <button className={`ct-chip ct-action${p.focused === t.id ? ' is-on' : ''}`} onClick={() => p.onFocus(t)}>
          {p.focused === t.id ? 'Clear highlight' : `Highlight + ${WINDOWS.find((w) => w.id === t.window)?.name} window`}
        </button>
        {t.levels.filter((l) => p.vol?.meta.levels.some((x) => x.id === l)).map((l) => (
          <button key={l} className="ct-chip" onClick={() => p.onLevel(l)}>Go to {LEVELS.find((x) => x.id === l)?.short}</button>
        ))}
      </div>
      <p className="ct-hint">Educational summary of typical locations on normal anatomy — not a diagnostic rule. No pathology images are shown.</p>
    </div>
  )
}

function QuizPanel(p: { vol: Volume; kind: QuizKind; setKind: (k: QuizKind) => void; question: Question | null; answer: { given: string; ok: boolean } | null; score: { right: number; total: number }; onAnswer: (id: string) => void; onNext: () => void }) {
  const q = p.question
  const kinds: { id: QuizKind; label: string; need?: boolean }[] = [
    { id: 'level', label: 'Name the level' },
    { id: 'name', label: 'Name the structure', need: !p.vol.labels },
    { id: 'find', label: 'Find the structure' },
  ]
  const nameOf = (id: string) => LEVELS.find((l) => l.id === id)?.name ?? STRUCTURES[id]?.name ?? p.vol.meta.landmarks.find((l) => l.id === id)?.name ?? id
  return (
    <div className="ct-card">
      <div className="ct-chips">
        {kinds.map((k) => (
          <button key={k.id} className={`ct-chip${p.kind === k.id ? ' is-on' : ''}`} disabled={k.need}
            title={k.need ? 'Needs a segmented case' : undefined} onClick={() => p.setKind(k.id)}>{k.label}</button>
        ))}
      </div>
      <p className="ct-score">Score {p.score.right}/{p.score.total}</p>
      {!q && <p className="ct-hint">Not enough data in this case for this question type.</p>}
      {q && (
        <>
          <h2>{q.prompt}</h2>
          {q.kind !== 'find' && (
            <div className="ct-options">
              {q.options!.map((o) => {
                const cls = p.answer ? (o.id === q.answer ? ' is-right' : o.id === p.answer.given ? ' is-wrong' : '') : ''
                return <button key={o.id} className={`ct-option${cls}`} onClick={() => p.onAnswer(o.id)} disabled={!!p.answer}>{o.label}</button>
              })}
            </div>
          )}
          {q.kind === 'find' && !p.answer && <p className="ct-hint">Click on the scan. You may scroll first.</p>}
          {p.answer && (
            <div className={`ct-result${p.answer.ok ? ' is-right' : ' is-wrong'}`}>
              <strong>{p.answer.ok ? 'Correct.' : 'Not quite.'}</strong>{' '}
              {!p.answer.ok && <>Answer: {nameOf(q.answer)}{q.kind === 'find' ? ` (you clicked: ${nameOf(p.answer.given)})` : ''}. </>}
              {q.explain}
            </div>
          )}
          <button className="ct-chip ct-action" onClick={p.onNext}>{p.answer ? 'Next question' : 'Skip'}</button>
        </>
      )}
    </div>
  )
}

function DataPanel(p: {
  vol: Volume; cursor: Voxel; levels: LevelAnchor[]; landmarks: Landmark[]; edited: boolean
  setLevels: (l: LevelAnchor[]) => void; setLandmarks: (l: Landmark[]) => void; reset: () => void
}) {
  const m = p.vol.meta
  const [levelId, setLevelId] = useState(LEVELS[0].id)
  const [lmName, setLmName] = useState('')
  const json = JSON.stringify({ levels: p.levels.map(({ id, z }) => ({ id, z })), landmarks: p.landmarks }, null, 1)
  return (
    <div className="ct-card">
      <h2>{m.title}</h2>
      {m.summary && <p>{m.summary}</p>}
      <dl className="ct-dl">
        <dt>Source</dt><dd>{m.sourceUrl ? <a href={m.sourceUrl} target="_blank" rel="noreferrer">{m.source}</a> : m.source}</dd>
        <dt>Licence</dt><dd>{m.termsUrl ? <a href={m.termsUrl} target="_blank" rel="noreferrer">{m.license}</a> : m.license}</dd>
        {m.attribution && (<><dt>Credit</dt><dd>{m.attribution}</dd></>)}
        <dt>Grid</dt><dd>{m.dims.join(' × ')} voxels @ {m.spacing.map((s) => s.toFixed(2)).join(' × ')} mm</dd>
        <dt>Intensity</dt><dd>{m.intensity?.calibrated === false ? m.intensity.note : 'Calibrated Hounsfield units'}</dd>
        <dt>Segmentation</dt><dd>{m.segmentation ? `${m.segmentation.tool}: ${m.segmentation.tasks.join(', ')}. ${m.segmentation.note ?? ''}` : 'None'}</dd>
      </dl>
      {m.limitations && <><h4>Limitations</h4><ul>{m.limitations.map((l) => <li key={l}>{l}</li>)}</ul></>}

      <h4>Author: levels & landmarks</h4>
      <p className="ct-hint">Edits are stored in this browser only. Copy the JSON into <code>scripts/ct-anatomy/&lt;case&gt;.levels.json</code> and rebuild the case to publish them.</p>
      <div className="ct-row">
        <select value={levelId} onChange={(e) => setLevelId(e.target.value)} className="ct-select" aria-label="Level">
          {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button className="ct-chip" onClick={() => p.setLevels([...p.levels.filter((l) => l.id !== levelId), { id: levelId, z: p.cursor[2] }].sort((a, b) => a.z - b.z))}>
          Set to axial {p.cursor[2]}
        </button>
      </div>
      <div className="ct-row">
        <input className="ct-input" placeholder="Landmark name" value={lmName} onChange={(e) => setLmName(e.target.value)} />
        <button className="ct-chip" disabled={!lmName.trim()} onClick={() => {
          const id = lmName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
          p.setLandmarks([...p.landmarks.filter((l) => l.id !== id), { id, name: lmName.trim(), xyz: [...p.cursor] as Voxel }])
          setLmName('')
        }}>Add at cursor</button>
      </div>
      <div className="ct-row">
        <button className="ct-chip" onClick={() => navigator.clipboard?.writeText(json)}>Copy JSON</button>
        {p.edited && <button className="ct-chip" onClick={p.reset}>Discard local edits</button>}
      </div>
      <pre className="ct-json">{json}</pre>
    </div>
  )
}

function SliceBar(p: { vol: Volume; plane: Plane; cursor: Voxel; onCursor: (c: Voxel) => void }) {
  const g = planeGeom(p.vol, p.plane)
  const axis = p.plane === 'axial' ? 2 : p.plane === 'coronal' ? 1 : 0
  const cur = sliceOf(p.plane, p.cursor)
  // slider runs inferior→superior (axial), posterior→anterior (coronal), right→left (sagittal)
  const toSlider = (sl: number) => (p.plane === 'coronal' ? g.count - 1 - sl : sl)
  const set = (val: number) => {
    const c: Voxel = [...p.cursor]
    c[axis] = p.plane === 'coronal' ? g.count - 1 - val : val
    p.onCursor(clampVoxel(p.vol, c))
  }
  const step = (d: number) => set(Math.max(0, Math.min(g.count - 1, toSlider(cur) + d)))
  const [lo, hi] = p.plane === 'axial' ? ['Inf', 'Sup'] : p.plane === 'coronal' ? ['Post', 'Ant'] : ['R', 'L']
  return (
    <div className="ct-slicebar" onPointerDown={(e) => e.stopPropagation()}>
      <button className="ct-step" onClick={() => step(-1)} aria-label="Previous slice">▼</button>
      <span className="ct-hint">{lo}</span>
      <input type="range" min={0} max={g.count - 1} step={1} value={toSlider(cur)} onChange={(e) => set(Number(e.target.value))} aria-label="Slice" />
      <span className="ct-hint">{hi}</span>
      <button className="ct-step" onClick={() => step(1)} aria-label="Next slice">▲</button>
    </div>
  )
}
