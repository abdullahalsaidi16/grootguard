/**
 * The hex choropleth (PRD F1).
 *
 * Geometry is built once from the H3 indices with h3-js - no polygon geometry
 * is shipped, which keeps the dataset small. Recolouring mutates the existing
 * feature objects in place and calls setData, so a budget-slider drag does not
 * reallocate 14,000 features per frame (F9).
 */
import { useEffect, useRef } from 'react'
import {
  AttributionControl,
  Map as MapLibreMap,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import { cellToBoundary } from 'h3-js'
import 'maplibre-gl/dist/maplibre-gl.css'
import { HAIRLINE, NO_DATA, PLANE } from './palette'

const CARTO_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// MapLibre works out its worker URL at runtime as a sibling of its own module
// (see scripts/vendor-maplibre-worker.mjs). That is invisible to the bundler,
// so the built site 404s on it and the map renders nothing, silently. Point at
// the copy staged into public/ instead - same path in dev and in the build.
setWorkerUrl(new URL(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`, document.baseURI).href)

/** C3: if the basemap cannot load, the app still works on shipped data. */
const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': PLANE } }],
}

async function resolveStyle(): Promise<StyleSpecification | string> {
  // ?nobasemap=1 forces the shipped-data-only style. Useful for testing the
  // C3 offline path deliberately rather than by pulling the network cable.
  if (new URLSearchParams(location.search).has('nobasemap')) {
    console.warn('[fusion] basemap disabled by query flag')
    return OFFLINE_STYLE
  }
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    const r = await fetch(CARTO_STYLE, { signal: ctrl.signal })
    clearTimeout(t)
    if (r.ok) return CARTO_STYLE
  } catch {
    /* fall through */
  }
  console.warn('[fusion] basemap unavailable - running on shipped data only (C3)')
  return OFFLINE_STYLE
}

export interface HexMapProps {
  cells: string[]
  /** palette index per cell; -1 renders as no-data */
  bins: Int8Array
  palette: string[]
  /** optional per-cell opacity multiplier, used to dim untreated cells */
  alpha?: Float64Array | null
  selected?: number | null
  onSelect?: (i: number | null) => void
  /** cells to outline, e.g. WUI hardening's texture-channel substitute */
  outline?: Uint8Array | null
  outlineColor?: string
  flyTo?: { lng: number; lat: number; zoom?: number } | null
  interactive?: boolean
  onHover?: (i: number | null, x: number, y: number) => void
}

export function HexMap({
  cells,
  bins,
  palette,
  alpha = null,
  selected = null,
  onSelect,
  outline = null,
  outlineColor = '#ffffff',
  flyTo = null,
  interactive = true,
  onHover,
}: HexMapProps) {
  const holder = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const features = useRef<Feature[]>([])
  const ready = useRef(false)
  const pending = useRef(false)
  const cleanups = useRef<Array<() => void>>([])

  // --- build geometry once -------------------------------------------------
  if (features.current.length === 0 && cells.length) {
    const t0 = performance.now()
    features.current = cells.map((h, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: {
        type: 'Polygon' as const,
        // h3-js returns [lng, lat] pairs when asked for GeoJSON order.
        coordinates: [cellToBoundary(h, true)],
      },
      // 'c' must exist from the start - fill-color reads it the moment the
      // layer is added, before the first paint() call.
      properties: { i, c: NO_DATA, a: 0.82, o: 0, sel: 0 },
    }))
    console.info(
      `[fusion] built ${cells.length} hexes in ${(performance.now() - t0).toFixed(0)}ms`,
    )
  }

  // --- create the map ------------------------------------------------------
  useEffect(() => {
    if (!holder.current || map.current) return
    let cancelled = false
    void (async () => {
      const style = await resolveStyle()
      if (cancelled || !holder.current) return
      const m = new MapLibreMap({
        container: holder.current,
        style,
        center: [-3.6, 40.0],
        zoom: 5.1,
        attributionControl: false,
        interactive,
      })
      map.current = m
      if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__fusionMap = m
      m.addControl(
        new AttributionControl({
          compact: false,
          customAttribution:
            'Cells: H3 · Fuel: ESA WorldCover (CC BY 4.0) · Population: Kontur (CC BY 4.0) · ' +
            'Assets & places: © OpenStreetMap contributors (ODbL) · Weather: Open-Meteo (CC BY 4.0) · ' +
            'Boundary: geoBoundaries / IGN (CC BY 4.0)',
        }),
        'bottom-right',
      )
      const install = () => {
        if (m.getSource('hex')) return
        m.addSource('hex', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: features.current } as FeatureCollection,
        })
        m.addLayer({
          id: 'hex-fill',
          type: 'fill',
          source: 'hex',
          paint: {
            'fill-color': ['get', 'c'],
            'fill-opacity': ['get', 'a'],
          },
        })
        m.addLayer({
          id: 'hex-outline',
          type: 'line',
          source: 'hex',
          filter: ['==', ['get', 'o'], 1],
          paint: { 'line-color': outlineColor, 'line-width': 1.1, 'line-opacity': 0.9 },
        })
        m.addLayer({
          id: 'hex-selected',
          type: 'line',
          source: 'hex',
          filter: ['==', ['get', 'sel'], 1],
          paint: { 'line-color': '#ffffff', 'line-width': 2.2 },
        })
        ready.current = true
        pending.current = false
        paint()
      }
      // A map created while the tab is hidden may have already finished its
      // style by the time we get here, in which case 'load' never fires again.
      if (m.isStyleLoaded()) install()
      else m.once('load', install)

      // Chrome suspends requestAnimationFrame in a hidden tab, and MapLibre
      // drives both tile loading and painting from that loop - so a map set up
      // off-screen stays blank until it is looked at. Nudge it when the tab
      // comes back, which is exactly the projector case: open the page, switch
      // away to present, switch back.
      const onVisible = () => {
        if (document.visibilityState !== 'visible') return
        m.resize()
        m.triggerRepaint()
        if (!m.getSource('hex') && m.isStyleLoaded()) install()
      }
      document.addEventListener('visibilitychange', onVisible)
      cleanups.current.push(() => document.removeEventListener('visibilitychange', onVisible))

      if (interactive) {
        m.on('click', 'hex-fill', (e: MapLayerMouseEvent) => {
          const f = e.features?.[0]
          onSelect?.(f ? (f.properties as { i: number }).i : null)
        })
        m.on('mousemove', 'hex-fill', (e: MapLayerMouseEvent) => {
          m.getCanvas().style.cursor = 'pointer'
          const f = e.features?.[0]
          onHover?.(f ? (f.properties as { i: number }).i : null, e.point.x, e.point.y)
        })
        m.on('mouseleave', 'hex-fill', () => {
          m.getCanvas().style.cursor = ''
          onHover?.(null, 0, 0)
        })
      }
    })()
    return () => {
      cancelled = true
      cleanups.current.forEach((fn) => fn())
      cleanups.current = []
      map.current?.remove()
      map.current = null
      ready.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- repaint -------------------------------------------------------------
  function paint() {
    const m = map.current
    if (!m || !ready.current) {
      pending.current = true
      return
    }
    const src = m.getSource('hex') as GeoJSONSource | undefined
    if (!src) return
    const fs = features.current
    for (let i = 0; i < fs.length; i++) {
      const b = bins[i]
      const p = fs[i].properties as Record<string, unknown>
      p.c = b < 0 ? NO_DATA : palette[Math.min(b, palette.length - 1)]
      p.a = b < 0 ? 0.35 : alpha ? alpha[i] : 0.82
      p.o = outline && outline[i] ? 1 : 0
      p.sel = selected === i ? 1 : 0
    }
    src.setData({ type: 'FeatureCollection', features: fs } as FeatureCollection)
  }

  useEffect(paint)

  // --- fly to a selected cell (F4) ----------------------------------------
  useEffect(() => {
    if (!flyTo || !map.current) return
    map.current.flyTo({
      center: [flyTo.lng, flyTo.lat],
      zoom: flyTo.zoom ?? 8.2,
      speed: 1.4,
      essential: true,
    })
  }, [flyTo])

  return <div ref={holder} className="map" style={{ background: PLANE, border: `1px solid ${HAIRLINE}` }} />
}
