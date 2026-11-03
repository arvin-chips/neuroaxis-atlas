/** CT Anatomy — quiz question generators (pure functions over a loaded case). */
import { LEVELS, STRUCTURES } from './content'
import { nearestLevel, type Volume, type Voxel } from './volume'

export type QuizKind = 'level' | 'name' | 'find'

export interface Question {
  kind: QuizKind
  prompt: string
  cursor: Voxel                 // where to put the viewer (axial)
  options?: { id: string; label: string }[]
  answer: string                // level id, label key or landmark id
  outlineLabel?: number         // 'name': label value to outline
  explain: string
}

const rnd = (n: number) => Math.floor(Math.random() * n)
function shuffle<T>(a: T[]): T[] {
  const b = [...a]
  for (let i = b.length - 1; i > 0; i--) { const j = rnd(i + 1); [b[i], b[j]] = [b[j], b[i]] }
  return b
}

function center(v: Volume, z: number): Voxel { return [Math.floor(v.nx / 2), Math.floor(v.ny / 2), z] }

export function levelQuestion(v: Volume): Question | null {
  const anchors = v.meta.levels
  if (anchors.length < 2) return null
  const a = anchors[rnd(anchors.length)]
  // jitter but stay closest to the same anchor
  let z = a.z
  for (let k = 0; k < 10; k++) {
    const t = Math.max(0, Math.min(v.nz - 1, a.z + rnd(7) - 3))
    if (nearestLevel(anchors, t)?.anchor.id === a.id) { z = t; break }
  }
  const info = LEVELS.find((l) => l.id === a.id)!
  const pool = anchors.map((x) => x.id).filter((id) => id !== a.id)
  const opts = shuffle([a.id, ...shuffle(pool).slice(0, 3)])
  return {
    kind: 'level',
    prompt: 'Which anatomical level is this axial slice?',
    cursor: center(v, z),
    options: opts.map((id) => ({ id, label: LEVELS.find((l) => l.id === id)?.name ?? id })),
    answer: a.id,
    explain: info.recognise,
  }
}

/** Pick a label that is well represented on some axial slice. */
function pickLabelSlice(v: Volume): { value: number; z: number } | null {
  if (!v.labels) return null
  const values = [...v.labelDefs.keys()].filter((k) => k !== 2 && k !== 30) // skip diffuse CSF/skull masks
  const minPx = 60 / (v.sx * v.sy)
  for (let tries = 0; tries < 40; tries++) {
    const value = values[rnd(values.length)]
    const z = rnd(v.nz)
    const off = z * v.nx * v.ny
    let n = 0
    for (let i = 0; i < v.nx * v.ny; i++) if (v.labels[off + i] === value) n++
    if (n >= minPx) return { value, z }
  }
  return null
}

export function nameQuestion(v: Volume): Question | null {
  const pick = pickLabelSlice(v)
  if (!pick) return null
  const def = v.labelDefs.get(pick.value)!
  const others = shuffle([...v.labelDefs.values()].filter((d) => d.key !== def.key)).slice(0, 3)
  return {
    kind: 'name',
    prompt: 'Name the outlined structure.',
    cursor: center(v, pick.z),
    options: shuffle([def, ...others]).map((d) => ({ id: d.key, label: d.name })),
    answer: def.key,
    outlineLabel: pick.value,
    explain: STRUCTURES[def.key]?.find ?? '',
  }
}

export function findQuestion(v: Volume): Question | null {
  const useLandmark = !v.labels || (v.meta.landmarks.length > 0 && Math.random() < 0.3)
  if (useLandmark) {
    const lms = v.meta.landmarks
    if (!lms.length) return null
    const lm = lms[rnd(lms.length)]
    return {
      kind: 'find',
      prompt: `Click on: ${lm.name.replace(/ \((R|L)\)$/, '')}`,
      cursor: center(v, lm.xyz[2]),
      answer: lm.id,
      explain: STRUCTURES[lm.id]?.find ?? '',
    }
  }
  const pick = pickLabelSlice(v)
  if (!pick) return null
  const def = v.labelDefs.get(pick.value)!
  return {
    kind: 'find',
    prompt: `Click on: ${def.name}`,
    cursor: center(v, pick.z),
    answer: def.key,
    explain: STRUCTURES[def.key]?.find ?? '',
  }
}

export function makeQuestion(v: Volume, kind: QuizKind): Question | null {
  return kind === 'level' ? levelQuestion(v) : kind === 'name' ? nameQuestion(v) : findQuestion(v)
}
