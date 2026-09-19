/** Shapes of the prepared datasets written by the Python pipeline. */

/** data/cells.json - one entry per analysis cell, columnar to keep it small. */
export interface CellData {
  cells: string[]
  tree: number[]
  shrub: number[]
  grass: number[]
  land_frac: number[]
  area_ha: number[]
  pop: number[]
  pop_exposed: number[]
  pop10km: number[]
  C: number[]
  asset_score: number[]
  assets: number[][]
  top_asset: number[]
  top_asset_name: (string | null)[]
  name: (string | null)[]
  province: (string | null)[]
  wpt: number[]
  asset_classes: string[]
  weather_points: string[]
}

/** data/weather_current.json */
export interface WeatherCurrent {
  points: string[]
  this_week: { W: number[]; M: number[] }
  last_week: { W: number[]; M: number[] }
  generated_utc: string
  source: string
}

/** data/weather_history.json - point id -> ISO week -> [W, M] */
export type WeatherHistory = Record<string, Record<string, [number, number]>>

export interface DataBundle {
  cells: CellData
  weather: WeatherCurrent
  history: WeatherHistory | null
  /** true when any shipped file is marked synthetic (D3) */
  synthetic: boolean
}
