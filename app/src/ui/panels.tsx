/**
 * Ranking list (F4), cell detail (F5), layer switcher (F6), legend and the
 * plain-language answer strip.
 *
 * Layout direction A ("Situation Board"): the map takes the room back. The
 * ranking is compact enough that all twenty zones are visible without
 * scrolling, and the detail panel floats over the map on selection rather than
 * reserving 360px of width that sits empty until something is clicked.
 */
import type { CellData } from '../data/types'
import { LAYERS, type LayerKey, type Layers } from '../model/derive'
import { RAMP } from '../map/palette'

const ASSET_LABELS: Record<string, string> = {
  hospital: 'hospital',
  power_plant: 'power plant',
  substation: 'substation',
  school: 'school',
  industrial: 'industrial site',
  rail_motorway: 'railway or motorway',
}
const ASSET_ARTICLE: Record<string, string> = {
  hospital: 'a', power_plant: 'a', substation: 'a',
  school: 'a', industrial: 'an', rail_motorway: 'a',
}

export const fmt = new Intl.NumberFormat('en-GB')
export const fmt1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })
export const fmt2 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })

export function placeLabel(cells: CellData, i: number): { name: string; province: string } {
  const province = cells.province[i] ?? 'unknown province'
  return { name: cells.name[i] ?? province, province }
}

// ------------------------------------------------------------ answer strip

export interface Headline {
  ranked: number
  worsened: number
  points: number
  turnover: number
}

/** States the finding in words before any number, for someone who has never
 *  seen the tool (J1). Every figure is computed, never written in. */
export function AnswerStrip({ h, week }: { h: Headline; week: 'this' | 'last' }) {
  return (
    <div className="answer">
      <span className="answer-big">20</span>
      <p className="answer-txt">
        zones to protect first
        {week === 'this' ? ' this week' : ' last week'}, out of{' '}
        <b>{fmt.format(h.ranked)}</b> ranked.{' '}
        {h.worsened > 0 ? (
          <>
            Fire weather worsened at <b>{h.worsened} of {h.points}</b> weather stations
            {h.turnover > 0 ? (
              <> — <b>{h.turnover} of the top 20</b> are new since last week.</>
            ) : '.'}
          </>
        ) : (
          <>Fire weather eased everywhere since last week.</>
        )}
      </p>
    </div>
  )
}

// ----------------------------------------------------------------- ranking

export function RankList({
  cells, layers, order, selected, onSelect, deltas,
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
        <h2>Act first</h2>
        <span>{fmt.format(order.length)} ranked</span>
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
                title={`${name}, ${province}`}
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
                    {d === 0 ? '–' : d > 0 ? `▲${d}` : `▼${-d}`}
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
 * F5: names the highest-scoring asset and the population within ~10 km of it.
 * The wording describes PROXIMITY only — the model never traces which people an
 * asset serves, and this sentence must not imply that it does.
 */
export function reasonSentence(cells: CellData, i: number): string {
  const top = cells.top_asset[i]
  const { name } = placeLabel(cells, i)
  if (top < 0) {
    return (
      `No mapped critical asset sits here, so the score comes from people alone: about ` +
      `${fmt.format(Math.round(cells.pop_exposed[i]))} residents fall in the ` +
      `wildland-exposed share, plus the neighbouring cells.`
    )
  }
  const cls = cells.asset_classes[top]
  const label = ASSET_LABELS[cls] ?? cls
  const article = ASSET_ARTICLE[cls] ?? 'a'
  const named = cells.top_asset_name[i]
  return (
    `${name} ranks here because its highest-scoring asset is ${article} ` +
    `${named ? `${label} (${named})` : label}, and about ` +
    `${fmt.format(Math.round(cells.pop10km[i]))} people live within roughly 10 km of it. ` +
    `That is a proximity count — the model does not trace which of those people the ` +
    `asset actually serves.`
  )
}

export function DetailPanel({
  cells, layers, i, rank, onClose,
}: {
  cells: CellData
  layers: Layers
  i: number
  rank: number | null
  onClose: () => void
}) {
  const { name, province } = placeLabel(cells, i)
  const counts = cells.assets[i]
  const present = cells.asset_classes
    .map((c, j) => ({ c, n: counts[j] }))
    .filter((x) => x.n > 0)

  const rows: Array<[string, string]> = [
    ['Priority', fmt2.format(layers.priority[i])],
    ['At stake (C)', fmt2.format(layers.C[i])],
    ['Fuel (F)', fmt2.format(layers.F[i])],
    ['Fire weather (W)', fmt2.format(layers.W[i])],
    ['Moisture (M)', fmt2.format(layers.M[i])],
    ['Combustion', fmt2.format(layers.combustion[i])],
  ]

  return (
    <aside className="detail">
      <div className="detail-head">
        <div>
          <h3>{name}</h3>
          <p>{province}{rank !== null ? ` · ranked #${rank + 1}` : ''}</p>
        </div>
        <button className="detail-close" onClick={onClose} aria-label="Close detail">✕</button>
      </div>

      <p className="reason">{reasonSentence(cells, i)}</p>

      <div className="kv">
        {rows.map(([k, v]) => (
          <div key={k} className="kv-row"><span>{k}</span><b>{v}</b></div>
        ))}
      </div>

      <div className="kv">
        <div className="kv-row"><span>People here</span><b>{fmt.format(Math.round(cells.pop[i]))}</b></div>
        <div className="kv-row"><span>Wildland-exposed</span><b>{fmt.format(Math.round(cells.pop_exposed[i]))}</b></div>
        <div className="kv-row"><span>Within ~10 km</span><b>{fmt.format(Math.round(cells.pop10km[i]))}</b></div>
        <div className="kv-row"><span>Land area</span><b>{fmt.format(Math.round(cells.area_ha[i]))} ha</b></div>
      </div>

      <h4>Assets here</h4>
      {present.length === 0 ? (
        <p className="muted small">None mapped in OpenStreetMap.</p>
      ) : (
        <ul className="assets">
          {present.map((x) => (
            <li key={x.c}><span>{ASSET_LABELS[x.c] ?? x.c}</span><b>{x.n}</b></li>
          ))}
        </ul>
      )}

      <h4>Cover</h4>
      <CoverBar label="Tree" v={cells.tree[i]} />
      <CoverBar label="Shrub" v={cells.shrub[i]} />
      <CoverBar label="Grass" v={cells.grass[i]} />
    </aside>
  )
}

function CoverBar({ label, v }: { label: string; v: number }) {
  return (
    <div className="cover-row">
      <span>{label}</span>
      <div className="cover-track"><div className="cover-fill" style={{ width: `${Math.min(100, v * 100)}%` }} /></div>
      <b>{Math.round(v * 100)}%</b>
    </div>
  )
}

// ------------------------------------------------------------------ layers

export function LayerSwitcher({
  value, onChange,
}: { value: LayerKey; onChange: (k: LayerKey) => void }) {
  const keys: LayerKey[] = ['priority', 'consequence', 'fuel', 'weather', 'moisture', 'combustion']
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
      {/* Always on screen: "Fire weather" does not tell anyone what it measures. */}
      <p className="layers-plain">{LAYERS[value].plain}</p>
    </div>
  )
}

export function RampLegend({ layer }: { layer: LayerKey }) {
  const info = LAYERS[layer]
  return (
    <div className="legend">
      <div className="legend-title">{info.label}</div>
      <div className="legend-ramp">{RAMP.map((c) => <span key={c} style={{ background: c }} />)}</div>
      <div className="legend-ends"><span>{info.low}</span><span>{info.high}</span></div>
      <div className="legend-nodata"><span className="swatch-nodata" /> no data / too little fuel</div>
      <div className="legend-formula">{info.formula}</div>
      <div className="legend-note">Colour is by rank: each shade holds a seventh of the cells.</div>
    </div>
  )
}
