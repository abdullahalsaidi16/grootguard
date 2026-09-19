/**
 * Typed access to constants.json (PRD F19).
 *
 * The file at the repository root is the single source of truth: the Python
 * pipeline reads it, this module reads it, and the methodology panel (F18)
 * renders it. Nothing in the app may hard-code a model number - if a value is
 * not here, it does not belong in the model.
 */
import raw from '../../../constants.json'

export type Status = 'source' | 'assumption' | 'placeholder'

export interface Entry {
  value: unknown
  unit?: string
  label?: string
  status: Status
  source: string
}

export const CONSTANTS = raw as unknown as Record<string, any>

/** Read a dotted path and unwrap the {value,status,source} envelope. */
export function k<T = number>(path: string): T {
  let node: any = raw
  for (const part of path.split('.')) {
    node = node?.[part]
    if (node === undefined) throw new Error(`constants.json: missing ${path}`)
  }
  return (node && typeof node === 'object' && 'value' in node ? node.value : node) as T
}

/** Read the full envelope, for the methodology panel. */
export function entry(path: string): Entry {
  let node: any = raw
  for (const part of path.split('.')) node = node?.[part]
  return node as Entry
}

export interface Instrument {
  id: string
  label: string
  costPerHa: number      // midpoint where the source gives a range
  costLow: number
  costHigh: number
  effWorst: number
  effBest: number
  effMid: number
  capHa: number | null   // null = uncapped
  minExposedPop: number | null
  /** true when any figure behind this instrument is an unconfirmed placeholder */
  hasPlaceholder: boolean
}

function num(v: any): number {
  return typeof v === 'number' ? v : Number(v)
}

/** Instruments as defined in §9.4, with their placeholder provenance kept. */
export function instruments(): Instrument[] {
  const node = raw.allocation.instruments as Record<string, any>
  return Object.entries(node).map(([id, inst]) => {
    const cost = inst.cost_per_ha_eur
    const eff = inst.effectiveness
    const cap = inst.national_cap_ha
    const minPop = inst.min_exposed_population
    const statuses = [cost?.status, eff?.status, cap?.status, minPop?.status]
    return {
      id,
      label: inst.label as string,
      costLow: num(cost.value.low),
      costHigh: num(cost.value.high),
      costPerHa: (num(cost.value.low) + num(cost.value.high)) / 2,
      effWorst: num(eff.value.worst),
      effBest: num(eff.value.best),
      effMid: (num(eff.value.worst) + num(eff.value.best)) / 2,
      capHa: cap?.value === null || cap?.value === undefined ? null : num(cap.value),
      minExposedPop: minPop?.value === undefined ? null : num(minPop.value),
      hasPlaceholder: statuses.includes('placeholder'),
    }
  })
}

/** Every constant in the file, flattened for F18. */
export function allEntries(): Array<{ path: string; e: Entry }> {
  const out: Array<{ path: string; e: Entry }> = []
  const walk = (node: any, path: string) => {
    if (node && typeof node === 'object' && 'value' in node && 'status' in node) {
      out.push({ path, e: node as Entry })
      return
    }
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [key, child] of Object.entries(node)) {
        if (key.startsWith('$') || key === 'schema_version') continue
        walk(child, path ? `${path}.${key}` : key)
      }
    }
  }
  walk(raw, '')
  return out
}
