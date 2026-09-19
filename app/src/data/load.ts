/**
 * Loads the prepared datasets. Everything is shipped with the site (C1), so
 * these are same-origin fetches and the app keeps working with no network (C3).
 */
import type { CellData, DataBundle, WeatherCurrent, WeatherHistory } from './types'

const BASE = `${import.meta.env.BASE_URL}data`

async function getJSON<T>(name: string): Promise<T> {
  const r = await fetch(`${BASE}/${name}`)
  if (!r.ok) throw new Error(`failed to load ${name}: HTTP ${r.status}`)
  return (await r.json()) as T
}

/** Optional files must never take the app down (F8-style graceful degradation). */
async function getOptional<T>(name: string): Promise<T | null> {
  try {
    return await getJSON<T>(name)
  } catch {
    console.warn(`[fusion] optional dataset ${name} unavailable`)
    return null
  }
}

export async function loadData(): Promise<DataBundle> {
  const [cells, weather] = await Promise.all([
    getJSON<CellData>('cells.json'),
    getJSON<WeatherCurrent>('weather_current.json'),
  ])
  const history = await getOptional<WeatherHistory>('weather_history.json')

  const synthetic =
    (cells as unknown as { synthetic?: boolean }).synthetic === true ||
    (weather as unknown as { synthetic?: boolean }).synthetic === true

  return { cells, weather, history, synthetic }
}

/**
 * Map each cell onto its weather point by ID rather than by array position, so
 * the join cannot silently shift if either file is regenerated alone.
 */
export function weatherIndexForCells(cells: CellData, weather: WeatherCurrent): Int32Array {
  const pos = new Map<string, number>()
  weather.points.forEach((p, i) => pos.set(p, i))
  const out = new Int32Array(cells.cells.length).fill(-1)
  for (let i = 0; i < cells.cells.length; i++) {
    const id = cells.weather_points[cells.wpt[i]]
    const j = pos.get(id)
    if (j !== undefined) out[i] = j
  }
  return out
}
