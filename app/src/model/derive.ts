/**
 * Turns the prepared cell data plus a weather selection into the per-cell
 * layers the map and the ranking read (PRD F2, F3, F6).
 *
 * Kept as flat typed arrays: the whole grid is recomputed whenever the weather
 * selection changes, and that has to stay cheap enough to feel instant.
 */
import type { CellData } from '../data/types'
import { combustion, coverSum, fuelIndex, isBurnable, priority } from './scoring'
import { treatableHectares, type AllocInput } from './allocation'

export interface Layers {
  n: number
  F: Float64Array
  W: Float64Array
  M: Float64Array
  C: Float64Array
  combustion: Float64Array
  priority: Float64Array
  burnable: Uint8Array
  /** true when the cell has no usable input data (F3) */
  noData: Uint8Array
  treatableHa: Float64Array
  popExposed: Float64Array
}

export type LayerKey = 'priority' | 'consequence' | 'fuel' | 'weather' | 'moisture' | 'combustion'

export interface LayerInfo {
  /** short label on the button */
  label: string
  /** one plain sentence: what this actually means, no jargon */
  plain: string
  /** the maths, for anyone who wants it (J3, F18) */
  formula: string
  /** what the two ends of the scale mean */
  low: string
  high: string
}

export const LAYERS: Record<LayerKey, LayerInfo> = {
  priority: {
    label: 'Priority',
    plain: 'Where to act first. Combines how readily a place would burn with how much would be lost if it did.',
    formula: 'PRIORITY = combustion x consequence',
    low: 'act later',
    high: 'act first',
  },
  consequence: {
    label: 'What is at stake',
    plain: 'What would be affected if this cell burned: nearby residents plus hospitals, power plants, substations, schools, industry, road and rail.',
    formula: 'C = exposed people/8,000 + half the neighbours + capped asset scores',
    low: 'little to lose',
    high: 'much to lose',
  },
  fuel: {
    label: 'Fuel',
    plain: 'How much of the cell is vegetation that can carry a fire. This is land COVER, not biomass - it does not know how dense or how tall.',
    formula: 'F = 1.0 x tree + 0.8 x shrub + 0.5 x grass',
    low: 'bare / built / water',
    high: 'continuous vegetation',
  },
  weather: {
    label: 'Fire weather',
    plain: 'How hot, dry and windy this week is for this particular place, measured against its own ten-year normal - so a hot week in Galicia counts as much as a hot week in Almeria.',
    formula: 'W from temperature, humidity, wind and days since rain (0.6 calm - 1.6 extreme)',
    low: '0.6 - calm for here',
    high: '1.6 - extreme for here',
  },
  moisture: {
    label: 'Ground moisture',
    plain: 'How wet the ground is after the last 30 days of rain. Wetter ground is harder to ignite, so high moisture pushes priority DOWN.',
    formula: 'M from 30-day antecedent precipitation (0 bone dry - 1 saturated)',
    low: '0 - bone dry',
    high: '1 - saturated',
  },
  combustion: {
    label: 'How easily it burns',
    plain: 'Fuel, fire weather and dryness together - how readily this place would burn if something ignited it. Takes no account of what is at stake.',
    formula: 'COMBUSTION = F x W x (0.4 + 0.6 x (1 - M))',
    low: 'unlikely to carry fire',
    high: 'readily carries fire',
  },
}

/** Kept for compatibility with existing call sites. */
export const LAYER_LABELS: Record<LayerKey, string> = Object.fromEntries(
  Object.entries(LAYERS).map(([k, v]) => [k, v.label]),
) as Record<LayerKey, string>

export const LAYER_HELP: Record<LayerKey, string> = Object.fromEntries(
  Object.entries(LAYERS).map(([k, v]) => [k, v.plain]),
) as Record<LayerKey, string>

/**
 * Build every layer for one weather selection.
 * `wIdx` maps cell -> weather point; `W`/`M` are indexed by weather point.
 */
export function deriveLayers(
  cells: CellData,
  wIdx: Int32Array,
  W: number[],
  M: number[],
): Layers {
  const n = cells.cells.length
  const out: Layers = {
    n,
    F: new Float64Array(n),
    W: new Float64Array(n),
    M: new Float64Array(n),
    C: new Float64Array(n),
    combustion: new Float64Array(n),
    priority: new Float64Array(n),
    burnable: new Uint8Array(n),
    noData: new Uint8Array(n),
    treatableHa: new Float64Array(n),
    popExposed: new Float64Array(n),
  }

  for (let i = 0; i < n; i++) {
    const wi = wIdx[i]
    const f = fuelIndex(cells.tree[i], cells.shrub[i], cells.grass[i])
    const hasWeather = wi >= 0 && W[wi] !== undefined && M[wi] !== undefined

    out.F[i] = f
    out.C[i] = cells.C[i]
    out.popExposed[i] = cells.pop_exposed[i]

    if (!hasWeather) {
      // F3: missing input data is not low priority, it is no data.
      out.noData[i] = 1
      continue
    }

    const w = W[wi]
    const m = M[wi]
    out.W[i] = w
    out.M[i] = m

    const burnable = isBurnable(f)
    out.burnable[i] = burnable ? 1 : 0
    // F3: below the burnable threshold is also "not applicable".
    if (!burnable) {
      out.noData[i] = 1
      continue
    }

    const comb = combustion(f, w, m)
    out.combustion[i] = comb
    out.priority[i] = priority(comb, cells.C[i])
    out.treatableHa[i] = treatableHectares(
      cells.area_ha[i],
      coverSum(cells.tree[i], cells.shrub[i], cells.grass[i]),
    )
  }
  return out
}

/** Pick the array a given layer displays. */
export function layerValues(layers: Layers, key: LayerKey): Float64Array {
  switch (key) {
    case 'priority': return layers.priority
    case 'consequence': return layers.C
    case 'fuel': return layers.F
    case 'weather': return layers.W
    case 'moisture': return layers.M
    case 'combustion': return layers.combustion
  }
}

export function toAllocInput(layers: Layers): AllocInput {
  return {
    n: layers.n,
    priority: layers.priority,
    treatableHa: layers.treatableHa,
    popExposed: layers.popExposed,
    burnable: layers.burnable,
  }
}

/** Descending priority order, skipping no-data cells (F4). */
export function rankOrder(layers: Layers): Int32Array {
  const idx: number[] = []
  for (let i = 0; i < layers.n; i++) if (!layers.noData[i]) idx.push(i)
  idx.sort((a, b) => layers.priority[b] - layers.priority[a])
  return Int32Array.from(idx)
}

/** Position of every cell in the ranking, for the week-on-week delta (F7). */
export function rankPositions(order: Int32Array, n: number): Int32Array {
  const pos = new Int32Array(n).fill(-1)
  for (let r = 0; r < order.length; r++) pos[order[r]] = r
  return pos
}
