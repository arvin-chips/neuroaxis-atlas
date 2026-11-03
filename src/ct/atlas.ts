/**
 * Read-only access to the NeuroAxis structure records for the CT module.
 * Imports the JSON directly (not src/data/load.ts) so the CT page does not
 * pull three.js and the plate/geometry data into its bundle.
 */
import type { StructureRecord } from '../types'

const modules = import.meta.glob('../data/structures/*.json', { eager: true, import: 'default' }) as Record<string, StructureRecord[]>
const byId = new Map<string, StructureRecord>()
for (const list of Object.values(modules)) for (const r of list) byId.set(r.id, r)

export function getAtlasRecord(id: string): StructureRecord | undefined {
  return byId.get(id)
}
