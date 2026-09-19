/**
 * Automated tests for the core model (PRD C7).
 *
 * The four properties the brief names explicitly:
 *   - budget is never exceeded
 *   - caps are never exceeded
 *   - risk removed never decreases as budget rises
 *   - zero budget gives an empty allocation
 * plus scoring checks against the formulas in §9.1-§9.3.
 */
import { describe, expect, it } from 'vitest'
import {
  BURNABLE_THRESHOLD,
  combustion,
  coverSum,
  fuelIndex,
  isBurnable,
  priority,
  residual,
} from './scoring'
import {
  allocate,
  buildCandidates,
  treatableHectares,
  type AllocInput,
} from './allocation'
import { instruments, k } from './constants'

// ---------------------------------------------------------------- scoring

describe('fuel (§9.1)', () => {
  it('weights tree, shrub and grass as specified', () => {
    expect(fuelIndex(1, 0, 0)).toBeCloseTo(1.0)
    expect(fuelIndex(0, 1, 0)).toBeCloseTo(0.8)
    expect(fuelIndex(0, 0, 1)).toBeCloseTo(0.5)
    expect(fuelIndex(0.5, 0.25, 0.25)).toBeCloseTo(0.5 + 0.2 + 0.125)
  })

  it('applies the burnable threshold', () => {
    expect(isBurnable(BURNABLE_THRESHOLD + 1e-9)).toBe(true)
    expect(isBurnable(BURNABLE_THRESHOLD)).toBe(false)
    expect(isBurnable(0)).toBe(false)
  })

  it('uses the unweighted cover sum for treatable area (§9.4)', () => {
    expect(coverSum(0.4, 0.3, 0.2)).toBeCloseTo(0.9)
  })
})

describe('combustion (§9.2)', () => {
  it('matches F x W x (0.4 + 0.6(1-M))', () => {
    expect(combustion(0.5, 1.2, 0)).toBeCloseTo(0.5 * 1.2 * 1.0)
    expect(combustion(0.5, 1.2, 1)).toBeCloseTo(0.5 * 1.2 * 0.4)
    expect(combustion(0.5, 1.2, 0.5)).toBeCloseTo(0.5 * 1.2 * 0.7)
  })

  it('is monotone decreasing in moisture', () => {
    const dry = combustion(0.6, 1.1, 0.1)
    const wet = combustion(0.6, 1.1, 0.9)
    expect(dry).toBeGreaterThan(wet)
  })
})

describe('priority and residual risk (§9.3, §9.5)', () => {
  it('multiplies combustion by consequence', () => {
    expect(priority(2, 3)).toBeCloseTo(6)
  })

  it('leaves untreated priority intact and reduces treated priority', () => {
    expect(residual(10, 0.5, false)).toBeCloseTo(10)
    expect(residual(10, 0.5, true)).toBeCloseTo(5)
  })
})

// ------------------------------------------------------------- allocation

/** A deterministic synthetic landscape; no fixture data required. */
function makeInput(n = 400): AllocInput {
  const prio = new Float64Array(n)
  const ha = new Float64Array(n)
  const pop = new Float64Array(n)
  const burn = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    // Spread of priorities and sizes, fully reproducible.
    prio[i] = 0.5 + ((i * 37) % 100) / 10
    const areaHa = 3613 * (0.4 + ((i * 17) % 60) / 100)
    const cover = 0.2 + ((i * 11) % 70) / 100
    ha[i] = treatableHectares(areaHa, cover)
    pop[i] = ((i * 53) % 4000)
    burn[i] = 1
  }
  return { n, priority: prio, treatableHa: ha, popExposed: pop, burnable: burn }
}

const INPUT = makeInput()
const INSTS = instruments()
const CANDS = buildCandidates(INPUT, INSTS)

describe('allocation (§9.4, C7)', () => {
  it('spends nothing and treats nothing at zero budget', () => {
    const a = allocate(INPUT, CANDS, 0, INSTS)
    expect(a.spendEur).toBe(0)
    expect(a.cellsTreated).toBe(0)
    expect(a.treatedHa).toBe(0)
    expect(a.riskRemovedWorst).toBe(0)
    expect(a.riskRemovedBest).toBe(0)
    expect(Array.from(a.assigned).every((x) => x === -1)).toBe(true)
  })

  it('never exceeds the budget', () => {
    for (const b of [1e5, 1e6, 25e6, 100e6, 250e6, 500e6, 5e9]) {
      const a = allocate(INPUT, CANDS, b, INSTS)
      expect(a.spendEur).toBeLessThanOrEqual(b + 1e-6)
    }
  })

  it('never exceeds any instrument capacity cap', () => {
    for (const b of [1e6, 50e6, 200e6, 500e6, 5e9, 1e11]) {
      const a = allocate(INPUT, CANDS, b, INSTS)
      for (const o of a.byInstrument) {
        if (o.capHa !== null) expect(o.treatedHa).toBeLessThanOrEqual(o.capHa + 1e-6)
      }
    }
  })

  it('never decreases risk removed as budget rises', () => {
    let prevWorst = -1
    let prevBest = -1
    for (let b = 0; b <= 500e6; b += 10e6) {
      const a = allocate(INPUT, CANDS, b, INSTS)
      expect(a.riskRemovedWorst).toBeGreaterThanOrEqual(prevWorst - 1e-9)
      expect(a.riskRemovedBest).toBeGreaterThanOrEqual(prevBest - 1e-9)
      prevWorst = a.riskRemovedWorst
      prevBest = a.riskRemovedBest
    }
  })

  it('never spends more than the budget even on a fine sweep', () => {
    for (let b = 0; b <= 20e6; b += 137_000) {
      const a = allocate(INPUT, CANDS, b, INSTS)
      expect(a.spendEur).toBeLessThanOrEqual(b + 1e-6)
    }
  })

  it('assigns at most one instrument per cell', () => {
    const a = allocate(INPUT, CANDS, 300e6, INSTS)
    for (let i = 0; i < INPUT.n; i++) {
      if (a.assigned[i] === -1) expect(a.treatedFrac[i]).toBe(0)
      else expect(a.treatedFrac[i]).toBeGreaterThan(0)
    }
    // assigned is a single Int8 slot per cell, so "one instrument" is
    // structural; assert the treated fraction never exceeds the whole cell.
    expect(Array.from(a.treatedFrac).every((f) => f <= 1 + 1e-9)).toBe(true)
  })

  it('reports risk removed as a worst-to-best range, never a point (F11)', () => {
    const a = allocate(INPUT, CANDS, 150e6, INSTS)
    expect(a.riskRemovedBest).toBeGreaterThan(a.riskRemovedWorst)
  })

  it('reports spend that matches the per-instrument breakdown', () => {
    const a = allocate(INPUT, CANDS, 180e6, INSTS)
    const sum = a.byInstrument.reduce((s, o) => s + o.spendEur, 0)
    expect(sum).toBeCloseTo(a.spendEur, 3)
    const ha = a.byInstrument.reduce((s, o) => s + o.treatedHa, 0)
    expect(ha).toBeCloseTo(a.treatedHa, 3)
  })

  it('flags a binding cap once an instrument is exhausted', () => {
    const a = allocate(INPUT, CANDS, 5e9, INSTS)
    const capped = a.byInstrument.filter((o) => o.capHa !== null && o.capBinding)
    expect(capped.length).toBeGreaterThan(0)
  })

  it('respects the WUI minimum exposed population', () => {
    const wui = INSTS.findIndex((i) => i.id === 'wui_hardening')
    if (wui < 0 || INSTS[wui].minExposedPop === null) return
    const min = INSTS[wui].minExposedPop as number
    const a = allocate(INPUT, CANDS, 5e9, INSTS)
    for (let i = 0; i < INPUT.n; i++) {
      if (a.assigned[i] === wui) expect(INPUT.popExposed[i]).toBeGreaterThanOrEqual(min)
    }
  })

  it('treats nothing in cells below the burnable threshold', () => {
    const n = 50
    const input: AllocInput = {
      n,
      priority: new Float64Array(n).fill(5),
      treatableHa: new Float64Array(n).fill(100),
      popExposed: new Float64Array(n).fill(1000),
      burnable: new Uint8Array(n), // all zero: nothing is burnable
    }
    const cands = buildCandidates(input, INSTS)
    expect(cands.length).toBe(0)
    const a = allocate(input, cands, 500e6, INSTS)
    expect(a.cellsTreated).toBe(0)
    expect(a.spendEur).toBe(0)
  })
})

describe('constants file (F19)', () => {
  it('exposes the strategic share and budget ceiling', () => {
    expect(k('allocation.strategic_share')).toBeGreaterThan(0)
    expect(k('allocation.budget_max_eur')).toBe(500_000_000)
  })

  it('gives every instrument a cost and an effectiveness range', () => {
    for (const i of INSTS) {
      expect(i.costPerHa).toBeGreaterThan(0)
      expect(i.effBest).toBeGreaterThanOrEqual(i.effWorst)
      expect(i.effWorst).toBeGreaterThan(0)
      expect(i.effBest).toBeLessThanOrEqual(1)
    }
  })
})
