/**
 * FUSION — wildfire prevention prioritisation for Spain.
 *
 * Layout direction A, "Situation Board": one rail, the map taking the rest,
 * a plain-language answer above it and the cell detail floating on selection.
 */
import { useEffect, useMemo, useState } from 'react'
import { cellToLatLng } from 'h3-js'
import { HexMap } from './map/HexMap'
import { binValues, quantileBreaks, RAMP } from './map/palette'
import { loadData, weatherIndexForCells } from './data/load'
import type { DataBundle } from './data/types'
import {
  deriveLayers, layerValues, rankOrder, rankPositions, type LayerKey,
} from './model/derive'
import {
  AnswerStrip, DetailPanel, LayerSwitcher, RankList, RampLegend, fmt,
  type Headline,
} from './ui/panels'
import { Methodology } from './ui/Methodology'
import { Landing } from './ui/Landing'
import './styles.css'

type WeekChoice = 'this' | 'last'

/** Peninsular Spain + the Balearics, matching the grid's own window. */
const SPAIN_BOUNDS: [[number, number], [number, number]] = [[-9.6, 35.9], [4.5, 43.9]]

export default function App() {
  // The landing page is the default entry; #map goes straight to the console,
  // which is what the demo opens.
  const [showMap, setShowMap] = useState(() => location.hash === '#map')
  useEffect(() => {
    const onHash = () => setShowMap(location.hash === '#map')
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

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
    () => (data ? weatherIndexForCells(data.cells, data.weather) : null), [data])

  // Both weeks are derived so the ranking delta (F7) has something to compare.
  const thisWeek = useMemo(() => (data && wIdx
    ? deriveLayers(data.cells, wIdx, data.weather.this_week.W, data.weather.this_week.M)
    : null), [data, wIdx])
  const lastWeek = useMemo(() => (data && wIdx
    ? deriveLayers(data.cells, wIdx, data.weather.last_week.W, data.weather.last_week.M)
    : null), [data, wIdx])

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

  /** Everything the answer strip states is computed, never written in. */
  const headline: Headline | null = useMemo(() => {
    if (!data || !thisWeek || !lastWeek || !order) return null
    const tw = data.weather.this_week.W
    const lw = data.weather.last_week.W
    let worsened = 0
    for (let i = 0; i < tw.length; i++) if (tw[i] > lw[i]) worsened++
    const nowTop = new Set(Array.from(rankOrder(thisWeek).slice(0, 20)))
    const beforeTop = new Set(Array.from(rankOrder(lastWeek).slice(0, 20)))
    let turnover = 0
    nowTop.forEach((i) => { if (!beforeTop.has(i)) turnover++ })
    return { ranked: order.length, worsened, points: tw.length, turnover }
  }, [data, thisWeek, lastWeek, order])

  const values = useMemo(() => (layers ? layerValues(layers, layer) : null), [layers, layer])
  const bins = useMemo(() => {
    if (!layers || !values) return null
    return binValues(values, layers.noData, quantileBreaks(values, layers.noData))
  }, [layers, values])

  const rankOf = useMemo(
    () => (order && layers ? rankPositions(order, layers.n) : null), [order, layers])

  function select(i: number | null) {
    setSelected(i)
    if (i !== null && data) {
      const [lat, lng] = cellToLatLng(data.cells.cells[i])
      setFlyTo({ lng, lat })
    }
  }

  if (!showMap) return <Landing onEnter={() => { location.hash = '#map' }} />

  if (error) {
    return (
      <div className="boot boot-error">
        <h1>FUSION</h1>
        <p>Could not load the prepared data.</p>
        <code>{error}</code>
        <p className="muted">Run the pipeline, then <code>npm run stage:data</code>.</p>
      </div>
    )
  }
  if (!data || !layers || !bins || !order || !headline) {
    return <div className="boot"><h1>FUSION</h1><p className="muted">Loading prepared data…</p></div>
  }

  return (
    <div className="app">
      {data.synthetic ? (
        <div className="banner-synthetic">
          ⚠ SYNTHETIC DATA — parts of this dataset are placeholders generated for
          development (D3). Not for demonstration or decisions.
        </div>
      ) : null}

      <header className="top">
        <a className="brand" href="#" onClick={() => setShowMap(false)}>
          <span className="brand-mark">FUSION</span>
          <span className="brand-sub">wildfire prevention · Spain</span>
        </a>
        <div className="top-right">
          <div className="weeks">
            <button className={`chip ${week === 'this' ? 'chip-on' : ''}`}
                    onClick={() => setWeek('this')}>This week</button>
            <button className={`chip ${week === 'last' ? 'chip-on' : ''}`}
                    onClick={() => setWeek('last')}>Last week</button>
          </div>
          <button className="chip" onClick={() => setShowMethod(true)}>Methodology</button>
        </div>
      </header>

      <AnswerStrip h={headline} week={week} />

      <main className="grid">
        <aside className="left">
          <RankList
            cells={data.cells} layers={layers} order={order}
            selected={selected} onSelect={select}
            deltas={week === 'this' ? deltas : null}
          />
        </aside>

        <section className="centre">
          <div className="map-wrap">
            <HexMap
              cells={data.cells.cells} bins={bins} palette={RAMP}
              selected={selected} onSelect={select} flyTo={flyTo}
              fitTo={SPAIN_BOUNDS}
            />
            <div className="map-overlay-top"><LayerSwitcher value={layer} onChange={setLayer} /></div>
            <div className="map-overlay-bottom"><RampLegend layer={layer} /></div>
            {selected !== null ? (
              <div className="map-overlay-right">
                <DetailPanel
                  cells={data.cells} layers={layers} i={selected}
                  rank={rankOf && rankOf[selected] >= 0 ? rankOf[selected] : null}
                  onClose={() => setSelected(null)}
                />
              </div>
            ) : null}
          </div>
          <div className="statusbar">
            <span><b>{fmt.format(order.length)}</b> ranked</span>
            <span><b>{fmt.format(layers.n - order.length)}</b> no data / not burnable</span>
            <span className="muted">
              {data.weather.source} · {data.weather.generated_utc.replace('T', ' ').replace('+00:00', ' UTC')}
            </span>
          </div>
        </section>
      </main>

      {showMethod ? <Methodology onClose={() => setShowMethod(false)} /> : null}
    </div>
  )
}
