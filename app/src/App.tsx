/**
 * FUSION - wildfire prevention prioritisation for Spain.
 *
 * View 1 (this file's default): current conditions - J1, J3.
 */
import { useEffect, useMemo, useState } from 'react'
import { cellToLatLng } from 'h3-js'
import { HexMap } from './map/HexMap'
import { binValues, quantileBreaks, RAMP } from './map/palette'
import { loadData, weatherIndexForCells } from './data/load'
import type { DataBundle } from './data/types'
import {
  deriveLayers,
  layerValues,
  rankOrder,
  rankPositions,
  type LayerKey,
} from './model/derive'
import { DetailPanel, LayerSwitcher, RankList, RampLegend, fmt } from './ui/panels'
import { Methodology } from './ui/Methodology'
import './styles.css'

type WeekChoice = 'this' | 'last'

export default function App() {
  const [data, setData] = useState<DataBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [layer, setLayer] = useState<LayerKey>('priority')
  const [week, setWeek] = useState<WeekChoice>('this')
  const [selected, setSelected] = useState<number | null>(null)
  const [showMethod, setShowMethod] = useState(false)
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number } | null>(null)

  useEffect(() => {
    loadData().then(setData).catch((e) => setError(String(e)))
  }, [])

  const wIdx = useMemo(
    () => (data ? weatherIndexForCells(data.cells, data.weather) : null),
    [data],
  )

  // Both weeks are derived so the ranking delta (F7) has something to compare.
  const thisWeek = useMemo(
    () => (data && wIdx ? deriveLayers(data.cells, wIdx, data.weather.this_week.W, data.weather.this_week.M) : null),
    [data, wIdx],
  )
  const lastWeek = useMemo(
    () => (data && wIdx ? deriveLayers(data.cells, wIdx, data.weather.last_week.W, data.weather.last_week.M) : null),
    [data, wIdx],
  )

  const layers = week === 'this' ? thisWeek : lastWeek
  const order = useMemo(() => (layers ? rankOrder(layers) : null), [layers])

  const deltas = useMemo(() => {
    if (!thisWeek || !lastWeek || !order) return null
    const now = rankPositions(order, thisWeek.n)
    const before = rankPositions(rankOrder(lastWeek), lastWeek.n)
    const d = new Int32Array(thisWeek.n)
    for (let i = 0; i < d.length; i++) {
      d[i] = before[i] >= 0 && now[i] >= 0 ? before[i] - now[i] : 0
    }
    return d
  }, [thisWeek, lastWeek, order])

  const values = useMemo(() => (layers ? layerValues(layers, layer) : null), [layers, layer])
  const bins = useMemo(() => {
    if (!layers || !values) return null
    const breaks = quantileBreaks(values, layers.noData)
    return binValues(values, layers.noData, breaks)
  }, [layers, values])

  const rankOf = useMemo(() => {
    if (!order || !layers) return null
    return rankPositions(order, layers.n)
  }, [order, layers])

  function select(i: number | null) {
    setSelected(i)
    if (i !== null && data) {
      const [lat, lng] = cellToLatLng(data.cells.cells[i])
      setFlyTo({ lng, lat })
    }
  }

  if (error) {
    return (
      <div className="boot boot-error">
        <h1>FUSION</h1>
        <p>Could not load the prepared data.</p>
        <code>{error}</code>
        <p className="muted">Run the pipeline: <code>make data</code></p>
      </div>
    )
  }
  if (!data || !layers || !bins || !order) {
    return (
      <div className="boot">
        <h1>FUSION</h1>
        <p className="muted">Loading prepared data…</p>
      </div>
    )
  }

  const ranked = order.length
  const noData = layers.n - ranked

  return (
    <div className="app">
      {data.synthetic ? (
        <div className="banner-synthetic">
          ⚠ SYNTHETIC DATA — parts of this dataset are placeholders generated for
          development (D3). Not for demonstration or decisions.
        </div>
      ) : null}

      <header className="top">
        <div className="brand">
          <span className="brand-mark">FUSION</span>
          <span className="brand-sub">
            wildfire prevention prioritisation · Spain
          </span>
        </div>
        <div className="top-right">
          <div className="weeks">
            <button
              className={`chip ${week === 'this' ? 'chip-on' : ''}`}
              onClick={() => setWeek('this')}
            >
              This week
            </button>
            <button
              className={`chip ${week === 'last' ? 'chip-on' : ''}`}
              onClick={() => setWeek('last')}
            >
              Last week
            </button>
          </div>
          <button className="chip" onClick={() => setShowMethod(true)}>
            Methodology
          </button>
        </div>
      </header>

      <main className="grid">
        <aside className="left">
          <RankList
            cells={data.cells}
            layers={layers}
            order={order}
            selected={selected}
            onSelect={select}
            deltas={week === 'this' ? deltas : null}
          />
        </aside>

        <section className="centre">
          <div className="map-wrap">
            <HexMap
              cells={data.cells.cells}
              bins={bins}
              palette={RAMP}
              selected={selected}
              onSelect={select}
              flyTo={flyTo}
            />
            <div className="map-overlay-top">
              <LayerSwitcher value={layer} onChange={setLayer} />
            </div>
            <div className="map-overlay-bottom">
              <RampLegend layer={layer} />
            </div>
          </div>
          <div className="statusbar">
            <span>
              <b>{fmt.format(ranked)}</b> cells ranked
            </span>
            <span>
              <b>{fmt.format(noData)}</b> no data / not burnable
            </span>
            <span className="muted">
              Weather: {data.weather.source} · {data.weather.generated_utc}
            </span>
          </div>
        </section>

        <aside className="right">
          {selected !== null ? (
            <DetailPanel
              cells={data.cells}
              layers={layers}
              i={selected}
              rank={rankOf ? (rankOf[selected] >= 0 ? rankOf[selected] : null) : null}
            />
          ) : (
            <div className="detail detail-empty">
              <h3>Select a zone</h3>
              <p className="muted">
                Click a cell on the map, or a row in the ranking, to see why it
                scores as it does.
              </p>
            </div>
          )}
        </aside>
      </main>

      {showMethod ? <Methodology onClose={() => setShowMethod(false)} /> : null}
    </div>
  )
}
