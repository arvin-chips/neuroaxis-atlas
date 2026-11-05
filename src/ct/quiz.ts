/** CT Anatomy — quiz questions built from the exam's hand-placed levels and landmarks. */
import { LEVELS, STRUCTURES } from './content'
import type { Annotations, LabelMeta, SeriesMeta } from './data'
import type { Patient } from './geometry'

export type QuizKind = 'level' | 'find' | 'name-structure' | 'find-structure'

export interface Question {
  kind: QuizKind
  prompt: string
  z: number                 // axial position to show (mm)
  options?: { id: string; label: string }[]
  answer: string
  explain: string
  labelId?: number          // structure quizzes: the TotalSegmentator label asked about
}

const rnd = (n: number) => Math.floor(Math.random() * n)
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = rnd(i + 1); [b[i], b[j]] = [b[j], b[i]] } return b }

export function levelQuestion(a: Annotations): Question | null {
  if (a.levels.length < 2) return null
  const sorted = [...a.levels].sort((x, y) => x.z - y.z)
  const k = rnd(sorted.length)
  const cur = sorted[k]
  // jitter within the half-distance to the neighbouring anchors so the answer stays unambiguous
  const below = k > 0 ? (cur.z - sorted[k - 1].z) / 2 : 3
  const above = k < sorted.length - 1 ? (sorted[k + 1].z - cur.z) / 2 : 3
  const z = cur.z + (Math.random() * 2 - 1) * Math.min(3, below * 0.6, above * 0.6)
  const pool = shuffle(sorted.filter((l) => l.id !== cur.id)).slice(0, 3).map((l) => l.id)
  return {
    kind: 'level', prompt: 'Which anatomical level is this axial image?', z,
    options: shuffle([cur.id, ...pool]).map((id) => ({ id, label: LEVELS.find((l) => l.id === id)?.name ?? id })),
    answer: cur.id, explain: LEVELS.find((l) => l.id === cur.id)?.recognise ?? '',
  }
}

export function findQuestion(a: Annotations): Question | null {
  if (!a.landmarks.length) return null
  const lm = a.landmarks[rnd(a.landmarks.length)]
  return {
    kind: 'find', prompt: `Tap: ${lm.name.replace(/ \((R|L)\)$/, '').replace(/, calcified \((R|L)\)$/, ', calcified')}`,
    z: lm.p[2], answer: lm.id, explain: STRUCTURES[lm.id]?.find ?? '',
  }
}

export const baseId = (id: string) => id.replace(/-(r|l)$/, '')

/** A tap within 8 mm of the landmark (either side for paired ones) counts. */
export function checkFind(a: Annotations, answer: string, p: Patient): boolean {
  return a.landmarks.some((lm) => baseId(lm.id) === baseId(answer) && Math.hypot(lm.p[0] - p[0], lm.p[1] - p[1], lm.p[2] - p[2]) <= 8)
}

/** Structure quizzes from the segmentation: a well-represented label, shown on its median slice. */
export function structureQuestion(kind: 'name-structure' | 'find-structure', lm: LabelMeta | null, metas: Map<string, SeriesMeta>): Question | null {
  if (!lm || lm.labels.length < 4) return null
  const sm = metas.get(`${lm.study}/${lm.series}`)
  if (!sm) return null
  const pool = lm.labels.filter((d) => d.volume_ml >= 0.3 && !['subarachnoid_space', 'skull', 'brain'].includes(d.source))
  const d = pool[rnd(pool.length)]
  const slices = lm.slices.filter((s) => s.present.includes(d.id)).map((s) => s.i)
  if (!slices.length) return null
  const k = slices[Math.floor(slices.length / 2) + rnd(Math.max(1, Math.floor(slices.length / 4))) - Math.floor(slices.length / 8)] ?? slices[slices.length >> 1]
  const z = sm.slices[Math.max(0, Math.min(sm.count - 1, k))].imagePositionPatient[2]
  const explain = STRUCTURES[d.teach ?? '']?.find ?? `${d.name} (${d.group}).`
  if (kind === 'find-structure') return { kind, prompt: `Tap: ${d.name}`, z, answer: String(d.id), labelId: d.id, explain }
  const sameGroup = shuffle(lm.labels.filter((x) => x.id !== d.id && x.group === d.group))
  const others = shuffle(lm.labels.filter((x) => x.id !== d.id && x.group !== d.group))
  const opts = shuffle([d, ...[...sameGroup, ...others].slice(0, 3)])
  return { kind, prompt: 'Name the outlined structure.', z, answer: String(d.id), labelId: d.id, explain,
    options: opts.map((o) => ({ id: String(o.id), label: o.name })) }
}
