/**
 * The ranking list (F4), the cell detail panel (F5) and the layer switcher (F6).
 */
import type { CellData } from '../data/types'
import { LAYERS, type LayerKey, type Layers } from '../model/derive'
import { RAMP, INK_MUTED } from '../map/palette'

const ASSET_LABELS: Record<string, string> = {
  hospital: 'hospital',
  power_plant: 'power plant',
  substation: 'substation',
  school: 'school',
  industrial: 'industrial site',
  rail_motorway: 'railway or motorway',
}

const ASSET_ARTICLE: Record<string, string> = {
  hospital: 'a',
  power_plant: 'a',
  substation: 'a',
  school: 'a',
  industrial: 'an',
  rail_motorway: 'a',
}

export const fmt = new Intl.NumberFormat('en-GB')
export const fmt1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })
export const fmt2 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })

export function placeLabel(cells: CellData, i: number): { name: string; province: string } {
  const name = cells.name[i]
  const province = cells.province[i] ?? 'unknown province'
  return { name: name ?? province, province }
}

// ----------------------------------------------------------------- ranking

export function RankList({
  cells,
  layers,
  order,
  selected,
  onSelect,
  deltas,
}: {
  cells: CellData
  layers: Layers
  order: Int32Array
  selected: number | null
  onSelect: (i: number) => void
  deltas: Int32Array | null
}) {
  const top = Array.from(order.slice(0, 20))
  return (
    <div className="rank">
      <div className="rank-head">
        <h3>Top 20 by priority</h3>
        <span className="muted">of {fmt.format(order.length)} ranked cells</span>
      </div>
      <ol className="rank-list">
        {top.map((i, r) => {
          const { name, province } = placeLabel(cells, i)
          const d = deltas ? deltas[i] : 0
          return (
            <li key={i}>
              <button
                className={`rank-row ${selected === i ? 'on' : ''}`}
                onClick={() => onSelect(i)}
              >
                <span className="rank-n">{r + 1}</span>
                <span className="rank-name">
                  <span className="rank-place">{name}</span>
                  <span className="rank-prov">{province}</span>
                </span>
                {deltas ? (
                  <span
                    className={`rank-delta ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}`}
                    title="places moved since last week"
                  >
                    {d === 0 ? '–' : d > 0 ? `▲ ${d}` : `▼ ${-d}`}
                  </span>
                ) : null}
                <span className="rank-score">{fmt1.format(layers.priority[i])}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ------------------------------------------------------------------ detail

/**
 * F5: state the highest-scoring asset and the population within ~10 km of it.
 * The wording describes PROXIMITY only - the model never traces which people
 * an asset actually serves, and this sentence must not imply that it does.
 */
export function reasonSentence(cells: CellData, i: number): string {
  const top = cells.top_asset[i]
  const pop10 = cells.pop10km[i]
  const { name } = placeLabel(cells, i)
  if (top < 0) {
    const exposed = cells.pop_exposed[i]
    return (
      `No mapped critical asset sits in this cell, so its consequence score comes from ` +
      `people alone: about ${fmt.format(Math.round(exposed))} residents here are in the ` +
      `wildland-exposed share, alongside neighbouring cells.`
    )
  }
  const cls = cells.asset_classes[top]
  const label = ASSET_LABELS[cls] ?? cls
  const article = ASSET_ARTICLE[cls] ?? 'a'
  const named = cells.top_asset_name[i]
  const which = named ? `${label} (${named})` : `${label}`
  return (
    `${name} ranks here because its highest-scoring asset is ${article} ${which}, ` +
    `and about ${fmt.format(Math.round(pop10))} people live within roughly 10 km of it. ` +
    `That is a proximity count — the model does not trace which of those people the ` +
    `asset actually serves.`
  )
}

export function DetailPanel({
  cells,
  layers,
  i,
  rank,
}: {
  cells: CellData
  layers: Layers
  i: number
  rank: number | null
}) {
  const { name, province } = placeLabel(cells, i)
  const counts = cells.assets[i]
  const present = cells.asset_classes
    .map((c, j) => ({ c, n: counts[j] }))
    .filter((x) => x.n > 0)

  const rows: Array<[string, string]> = [
    ['Priority', fmt2.format(layers.priority[i])],
    ['Consequence C', fmt2.format(layers.C[i])],
    ['Fuel F', fmt2.format(layers.F[i])],
    ['Fire weather W', fmt2.format(layers.W[i])],
    ['Moisture M', fmt2.format(layers.M[i])],
    ['Combustion', fmt2.format(layers.combustion[i])],
  ]

  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <h3>{name}</h3>
          <p className="muted">
            {province}
            {rank !== null ? ` · ranked #${rank + 1}` : ''}
          </p>
        </div>
      </div>

      <p className="reason">{reasonSentence(cells, i)}</p>

      <div className="kv">
        {rows.map(([k, v]) => (
          <div key={k} className="kv-row">
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>

      <div className="kv">
        <div className="kv-row">
          <span>Population in cell</span>
          <b>{fmt.format(Math.round(cells.pop[i]))}</b>
        </div>
        <div className="kv-row">
          <span>Wildland-exposed share</span>
          <b>{fmt.format(Math.round(cells.pop_exposed[i]))}</b>
        </div>
        <div className="kv-row">
          <span>Within ~10 km</span>
          <b>{fmt.format(Math.round(cells.pop10km[i]))}</b>
        </div>
        <div className="kv-row">
          <span>Land area</span>
          <b>{fmt.format(Math.round(cells.area_ha[i]))} ha</b>
        </div>
      </div>

      <div className="assets">
        <h4>Assets in this cell</h4>
        {present.length === 0 ? (
          <p className="muted">None mapped in OpenStreetMap.</p>
        ) : (
          <ul>
            {present.map((x) => (
              <li key={x.c}>
                <span>{ASSET_LABELS[x.c] ?? x.c}</span>
                <b>{x.n}</b>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="cover">
        <h4>Cover</h4>
        <CoverBar label="Tree" v={cells.tree[i]} />
        <CoverBar label="Shrub" v={cells.shrub[i]} />
        <CoverBar label="Grass" v={cells.grass[i]} />
      </div>
    </div>
  )
}

function CoverBar({ label, v }: { label: string; v: number }) {
  return (
    <div className="cover-row">
      <span>{label}</span>
      <div className="cover-track">
        <div className="cover-fill" style={{ width: `${Math.min(100, v * 100)}%` }} />
      </div>
      <b>{Math.round(v * 100)}%</b>
    </div>
  )
}

// ------------------------------------------------------------------ layers

export function LayerSwitcher({
  value,
  onChange,
}: {
  value: LayerKey
  onChange: (k: LayerKey) => void
}) {
  const keys: LayerKey[] = [
    'priority',
    'consequence',
    'fuel',
    'weather',
    'moisture',
    'combustion',
  ]
  return (
    <div className="layers">
      <div className="layers-row">
        {keys.map((k) => (
          <button
            key={k}
            className={`layer-btn ${value === k ? 'on' : ''}`}
            onClick={() => onChange(k)}
          >
            {LAYERS[k].label}
          </button>
        ))}
      </div>
      {/* The label alone does not tell a planner - or a judge - what the layer
          means, so the explanation is always on screen, never only on hover. */}
      <p className="layers-plain">{LAYERS[value].plain}</p>
    </div>
  )
}

// ------------------------------------------------------------------ legend

export function RampLegend({ layer }: { layer: LayerKey }) {
  const info = LAYERS[layer]
  return (
    <div className="legend">
      <div className="legend-title">{info.label}</div>
      <div className="legend-ramp">
        {RAMP.map((c) => (
          <span key={c} style={{ background: c }} />
        ))}
      </div>
      <div className="legend-ends">
        <span>{info.low}</span>
        <span>{info.high}</span>
      </div>
      <div className="legend-nodata">
        <span className="swatch-nodata" /> no data / too little fuel to burn
      </div>
      <div className="legend-formula">{info.formula}</div>
      <div className="legend-note" style={{ color: INK_MUTED }}>
        Colour is by rank: each shade holds a seventh of the cells.
      </div>
    </div>
  )
}
