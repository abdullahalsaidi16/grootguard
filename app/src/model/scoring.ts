/**
 * The scoring half of the domain model (PRD §9.1-§9.3).
 *
 * Fuel, combustion and priority are computed here rather than in the pipeline
 * because they move with the weather the user selects (F7) and with the
 * scenario they are looking at (F14). Consequence C is static and arrives
 * precomputed from the pipeline.
 */
import { k } from './constants'

export const W_TREE = k('fuel.w_tree')
export const W_SHRUB = k('fuel.w_shrub')
export const W_GRASS = k('fuel.w_grass')
export const BURNABLE_THRESHOLD = k('fuel.burnable_threshold')
const COMB_FLOOR = k('conditions.combustion_floor')
const COMB_SPAN = k('conditions.combustion_moisture_span')

/** F = 1.0*tree + 0.8*shrub + 0.5*grass  (§9.1) */
export function fuelIndex(tree: number, shrub: number, grass: number): number {
  return W_TREE * tree + W_SHRUB * shrub + W_GRASS * grass
}

/** §9.1: below this a cell has too little to burn and is not applicable (F3). */
export function isBurnable(F: number): boolean {
  return F > BURNABLE_THRESHOLD
}

/** COMBUSTION = F * W * (0.4 + 0.6*(1-M))  (§9.2) */
export function combustion(F: number, W: number, M: number): number {
  return F * W * (COMB_FLOOR + COMB_SPAN * (1 - M))
}

/** PRIORITY = COMBUSTION * C  (§9.3) */
export function priority(comb: number, C: number): number {
  return comb * C
}

/** Total treatable area in a cell: §9.4 uses raw cover sum, not weighted F. */
export function coverSum(tree: number, shrub: number, grass: number): number {
  return tree + shrub + grass
}

/** Residual risk after a decision (§9.5). */
export function residual(priorityValue: number, effectiveness: number, treated: boolean): number {
  return treated ? priorityValue * (1 - effectiveness) : priorityValue
}
