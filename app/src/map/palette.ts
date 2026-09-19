/**
 * Colour roles for the map and charts.
 *
 * The app is dark-only by C5, so only the dark steps are defined here. Every
 * categorical set below was checked with the data-viz validator against the
 * dark surface #1a1a19 rather than chosen by eye:
 *
 *  - Instruments are a categorical choropleth, which is an ALL-PAIRS form.
 *    No four-hue set clears the all-pairs floors, so the three land-treatment
 *    instruments take the three slots that do (blue/orange/aqua: worst pair
 *    CVD dE 9.4, normal-vision dE 20.9), and WUI hardening - which is spatially
 *    rare and categorically different - is carried by the texture channel
 *    instead of a fourth hue.
 *  - The prediction states are a STATUS set, not a series, so they use the
 *    reserved status palette and always ship with a label.
 *  - Layer ramps are sequential: one hue, monotone in lightness, running dark
 *    (near the surface = low) to bright (high).
 */

export const SURFACE = '#1a1a19'
export const PLANE = '#0d0d0d'
export const INK = '#ffffff'
export const INK_2 = '#c3c2b7'
export const INK_MUTED = '#898781'
export const GRID = '#2c2c2a'
export const AXIS = '#383835'
export const HAIRLINE = 'rgba(255,255,255,0.10)'

/** Sequential ramp, low -> high. Monotone OKLab L: 0.237 -> 0.883. */
export const RAMP = [
  '#2b1a10',
  '#5c2d12',
  '#8f4415',
  '#c05c17',
  '#e07a22',
  '#f5a63c',
  '#ffd08a',
]

/** F3: no data / not applicable - deliberately achromatic so it can never be
 *  mistaken for the low end of the ramp, which is a warm near-black. */
export const NO_DATA = '#3a3a38'

/** Validated all-pairs on the dark surface. Order is fixed, never cycled. */
export const INSTRUMENT_COLORS: Record<string, string> = {
  grazing: '#3987e5',
  prescribed_burning: '#d95926',
  mechanical_clearing: '#199e70',
  // Texture channel, not a fourth hue - see the note above.
  wui_hardening: '#c3c2b7',
}

export const WUI_ID = 'wui_hardening'

/** Reserved status palette - never reused for a series. */
export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
}

export const UNTREATED_DIM = '#242422'

/**
 * Quantile breaks over the cells that have data. A linear scale is unusable
 * here: consequence is extremely long-tailed (median 0.2, p99 60, max 141), so
 * a linear ramp paints the whole country the darkest step. The legend states
 * that the scale is by rank.
 */
export function quantileBreaks(values: Float64Array, valid: Uint8Array, steps = RAMP.length): number[] {
  const xs: number[] = []
  for (let i = 0; i < values.length; i++) if (!valid[i]) xs.push(values[i])
  if (!xs.length) return []
  xs.sort((a, b) => a - b)
  const breaks: number[] = []
  for (let i = 1; i < steps; i++) breaks.push(xs[Math.floor((xs.length * i) / steps)])
  return breaks
}

/** Assign each cell to a ramp bucket; -1 means no data (F3). */
export function binValues(
  values: Float64Array,
  noData: Uint8Array,
  breaks: number[],
): Int8Array {
  const out = new Int8Array(values.length)
  for (let i = 0; i < values.length; i++) {
    if (noData[i]) {
      out[i] = -1
      continue
    }
    const v = values[i]
    let b = 0
    while (b < breaks.length && v >= breaks[b]) b++
    out[i] = b
  }
  return out
}
