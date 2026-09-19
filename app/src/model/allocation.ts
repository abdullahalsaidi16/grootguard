/**
 * Budget allocation across prevention instruments (PRD §9.4, F9-F12).
 *
 * Treat only a strategic share of each cell's burnable area:
 *   treatable_ha = area_ha * (tree + shrub + grass) * STRAT
 *   cost         = treatable_ha * EUR/ha
 * One instrument per cell. Candidates are ranked by risk removed per euro -
 * PRIORITY * effectiveness / cost - and taken in that order, subject to each
 * instrument's national capacity cap and to the budget.
 *
 * The last cell the budget reaches is treated PARTIALLY rather than skipped.
 * That is both realistic (a strategic mosaic is funded by the hectare, not by
 * the cell) and the reason the C7 monotonicity property holds by construction:
 * the allocation for any budget is a prefix of one fixed candidate ordering, so
 * raising the budget can only extend it, never reshuffle it. Skipping an
 * unaffordable cell to reach a cheaper one further down would break that.
 */
import { instruments as loadInstruments, k, type Instrument } from './constants'

const STRAT = k('allocation.strategic_share')
const HA_PER_WORKER = k('workforce.hectares_per_worker_year')

export interface AllocInput {
  n: number
  priority: Float64Array
  /** hectares actually treatable in this cell, after the strategic share */
  treatableHa: Float64Array
  popExposed: Float64Array
  burnable: Uint8Array
}

export interface Candidate {
  cell: number
  inst: number
  /** risk removed per euro, using mid effectiveness */
  density: number
  costPerHa: number
  ha: number
}

export interface InstrumentOutcome {
  id: string
  label: string
  spendEur: number
  treatedHa: number
  cells: number
  capHa: number | null
  capBinding: boolean
  hasPlaceholder: boolean
}

export interface Allocation {
  assigned: Int8Array        // instrument index, -1 = untreated
  treatedFrac: Float64Array  // 0..1 of the cell's treatable area
  spendEur: number
  treatedHa: number
  byInstrument: InstrumentOutcome[]
  riskRemovedWorst: number
  riskRemovedBest: number
  totalPriority: number
  peopleCovered: number
  workforce: number
  cellsTreated: number
}

/** Treatable hectares for one cell, per §9.4. */
export function treatableHectares(areaHa: number, coverSum: number): number {
  return areaHa * coverSum * STRAT
}

function eligible(inst: Instrument, popExposed: number): boolean {
  if (inst.minExposedPop === null) return true
  return popExposed >= inst.minExposedPop
}

/**
 * Build the fixed candidate ordering. Depends on priority (so on weather and
 * scenario) but NOT on budget, so it is computed once and reused across every
 * slider position - which is what keeps F9 instant.
 */
export function buildCandidates(
  input: AllocInput,
  insts: Instrument[] = loadInstruments(),
): Candidate[] {
  const out: Candidate[] = []
  for (let c = 0; c < input.n; c++) {
    if (!input.burnable[c]) continue
    const ha = input.treatableHa[c]
    if (!(ha > 0)) continue
    const p = input.priority[c]
    if (!(p > 0)) continue
    for (let j = 0; j < insts.length; j++) {
      const inst = insts[j]
      if (!eligible(inst, input.popExposed[c])) continue
      const cost = ha * inst.costPerHa
      if (!(cost > 0)) continue
      out.push({
        cell: c,
        inst: j,
        density: (p * inst.effMid) / cost,
        costPerHa: inst.costPerHa,
        ha,
      })
    }
  }
  // Highest risk removed per euro first. Ties broken by cell index so the
  // ordering is deterministic across runs.
  out.sort((a, b) => b.density - a.density || a.cell - b.cell || a.inst - b.inst)
  return out
}

export function allocate(
  input: AllocInput,
  candidates: Candidate[],
  budgetEur: number,
  insts: Instrument[] = loadInstruments(),
): Allocation {
  const assigned = new Int8Array(input.n).fill(-1)
  const treatedFrac = new Float64Array(input.n)
  const capUsed = new Float64Array(insts.length)
  const capBinding = new Array<boolean>(insts.length).fill(false)
  const spendBy = new Float64Array(insts.length)
  const haBy = new Float64Array(insts.length)
  const cellsBy = new Int32Array(insts.length)

  let remaining = Math.max(0, budgetEur)
  let spend = 0
  let treatedHa = 0
  let worst = 0
  let best = 0
  let people = 0
  let cellsTreated = 0

  if (remaining > 0) {
    for (const cand of candidates) {
      if (remaining <= 0) break
      if (assigned[cand.cell] !== -1) continue
      const inst = insts[cand.inst]

      let ha = cand.ha
      if (inst.capHa !== null) {
        const capLeft = inst.capHa - capUsed[cand.inst]
        if (capLeft <= 0) {
          capBinding[cand.inst] = true
          continue // this cell can still be picked up by another instrument
        }
        if (capLeft < ha) {
          ha = capLeft
          capBinding[cand.inst] = true
        }
      }
      const affordable = remaining / cand.costPerHa
      if (affordable < ha) ha = affordable
      if (!(ha > 0)) continue

      const cost = ha * cand.costPerHa
      const frac = ha / cand.ha

      assigned[cand.cell] = cand.inst
      treatedFrac[cand.cell] = frac
      capUsed[cand.inst] += ha
      spendBy[cand.inst] += cost
      haBy[cand.inst] += ha
      cellsBy[cand.inst] += 1
      remaining -= cost
      spend += cost
      treatedHa += ha
      cellsTreated += 1

      const p = input.priority[cand.cell]
      worst += p * inst.effWorst * frac
      best += p * inst.effBest * frac
      people += input.popExposed[cand.cell] * frac
    }
  }

  let totalPriority = 0
  for (let c = 0; c < input.n; c++) totalPriority += input.priority[c]

  return {
    assigned,
    treatedFrac,
    spendEur: spend,
    treatedHa,
    byInstrument: insts.map((inst, j) => ({
      id: inst.id,
      label: inst.label,
      spendEur: spendBy[j],
      treatedHa: haBy[j],
      cells: cellsBy[j],
      capHa: inst.capHa,
      capBinding: capBinding[j],
      hasPlaceholder: inst.hasPlaceholder,
    })),
    riskRemovedWorst: worst,
    riskRemovedBest: best,
    totalPriority,
    peopleCovered: people,
    workforce: treatedHa / HA_PER_WORKER,
    cellsTreated,
  }
}

/** Diminishing-returns curve for F12: risk removed against budget. */
export function returnsCurve(
  input: AllocInput,
  candidates: Candidate[],
  maxBudget: number,
  steps = 24,
  insts: Instrument[] = loadInstruments(),
): Array<{ budget: number; worst: number; best: number }> {
  const out = []
  for (let i = 0; i <= steps; i++) {
    const budget = (maxBudget * i) / steps
    const a = allocate(input, candidates, budget, insts)
    out.push({ budget, worst: a.riskRemovedWorst, best: a.riskRemovedBest })
  }
  return out
}
