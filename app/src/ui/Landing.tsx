/**
 * Landing page — what someone sees before the console.
 *
 * Exists for the reader who arrives with no context: the problem, what the
 * tool does about it, and where every number comes from. The demo skips it by
 * opening #map directly.
 *
 * Headline figures are read from the prepared data at runtime rather than
 * written in, so the page cannot drift from the dataset it describes (D1).
 */
import { useEffect, useState } from 'react'
import { loadData } from '../data/load'
import { k } from '../model/constants'
import './landing.css'

interface Facts {
  cells: number
  ranked: number
  people: number
  assets: number
  weeks: number
  stamp: string
}

export function Landing({ onEnter }: { onEnter: () => void }) {
  const [f, setF] = useState<Facts | null>(null)

  useEffect(() => {
    loadData().then((d) => {
      const thr = k<number>('fuel.burnable_threshold')
      const wt = k<number>('fuel.w_tree'), ws = k<number>('fuel.w_shrub'), wg = k<number>('fuel.w_grass')
      const c = d.cells
      let ranked = 0, people = 0, assets = 0
      for (let i = 0; i < c.cells.length; i++) {
        const F = wt * c.tree[i] + ws * c.shrub[i] + wg * c.grass[i]
        if (F > thr) ranked++
        people += c.pop[i]
        for (const n of c.assets[i]) assets += n
      }
      const anyPoint = d.history ? Object.values(d.history)[0] : null
      setF({
        cells: c.cells.length,
        ranked,
        people,
        assets,
        weeks: anyPoint ? Object.keys(anyPoint).length : 0,
        stamp: d.weather.generated_utc.slice(0, 10),
      })
    }).catch(() => setF(null))
  }, [])

  const n = (x: number) => new Intl.NumberFormat('en-GB').format(Math.round(x))

  return (
    <div className="lp">
      <nav className="lp-nav">
        <span className="lp-brand">FUSION</span>
        <button className="lp-enter-sm" onClick={onEnter}>Open the map →</button>
      </nav>

      <header className="lp-hero">
        <p className="lp-eyebrow">Wildfire prevention prioritisation · Spain</p>
        <h1>
          Spain burned <span className="lp-fig">393,079&nbsp;ha</span> in 2025.
          A quarter of the large fires caused over three quarters of it.
        </h1>
        <p className="lp-lede">
          Maps already exist for fuel, for fire weather, for infrastructure, for population.
          They are published separately. A civil-protection planner deciding where to spend
          prevention money has no single view that ranks places by <em>what would be lost
          if they burned</em>.
        </p>
        <p className="lp-lede lp-lede-strong">
          FUSION fuses those four into one ranked priority per 36&nbsp;km² cell, re-ranked
          every week with the weather.
        </p>
        <div className="lp-cta">
          <button className="lp-enter" onClick={onEnter}>Open the live map</button>
          <a className="lp-link" href="https://github.com/abdullahalsaidi16/grootguard"
             target="_blank" rel="noopener noreferrer">Source and method →</a>
        </div>

        <dl className="lp-stats">
          <div><dt>cells analysed</dt><dd>{f ? n(f.cells) : '—'}</dd></div>
          <div><dt>ranked as burnable</dt><dd>{f ? n(f.ranked) : '—'}</dd></div>
          <div><dt>residents covered</dt><dd>{f ? `${(f.people / 1e6).toFixed(1)}M` : '—'}</dd></div>
          <div><dt>critical assets</dt><dd>{f ? n(f.assets) : '—'}</dd></div>
          <div><dt>weeks of history</dt><dd>{f ? n(f.weeks) : '—'}</dd></div>
        </dl>
      </header>

      <section className="lp-sec">
        <h2>One score, three questions</h2>
        <p className="lp-sub">
          Priority is a product, not a sum — a place has to fail on both halves to rank. Bare
          rock with a hospital scores near zero. Dense forest with nobody in it scores near
          zero. The wildland-urban interface scores high, which is where Spain's fires
          actually hurt.
        </p>
        <div className="lp-eq">
          <span className="lp-eq-term">
            <b>How readily it burns</b>
            <i>fuel × fire weather × dryness</i>
          </span>
          <span className="lp-eq-op">×</span>
          <span className="lp-eq-term">
            <b>What would be lost</b>
            <i>exposed residents, hospitals, power, schools, industry, road and rail</i>
          </span>
          <span className="lp-eq-op">=</span>
          <span className="lp-eq-term lp-eq-out">
            <b>Where to act first</b>
            <i>ranked, every week</i>
          </span>
        </div>
      </section>

      <section className="lp-sec">
        <h2>What you can do with it</h2>
        <ol className="lp-steps">
          <li>
            <h3>See what to protect first</h3>
            <p>Spain as {f ? n(f.cells) : '14,000'} hexagons, ranked. Click any one and it
               tells you in a sentence why it scores as it does — naming the asset and the
               people near it.</p>
          </li>
          <li>
            <h3>See what changed this week</h3>
            <p>Only the weather moves week to week. That is enough: in the current data the
               median zone shifts 182 places and half the top twenty is new.</p>
          </li>
          <li>
            <h3>Take the model apart</h3>
            <p>Switch between the six layers that make up the score — fuel, fire weather,
               moisture, combustion, what is at stake, and the fused priority — to see which
               one is driving any zone.</p>
          </li>
          <li>
            <h3>Check every number</h3>
            <p>The methodology panel lists every constant the model uses with its source, or
               the label <em>assumption</em>, or <em>placeholder</em> where the value is not
               yet confirmed. Nothing is hidden behind a round figure.</p>
          </li>
        </ol>
      </section>

      <section className="lp-sec">
        <h2>Where the numbers come from</h2>
        <p className="lp-sub">
          Every figure traces to a public dataset or to a named constant. Where a source could
          not be obtained, its term is switched off rather than estimated.
        </p>
        <ul className="lp-sources">
          <li><b>ESA WorldCover</b><span>10 m land cover, 2021 — vegetation that can carry fire</span><i>CC BY 4.0</i></li>
          <li><b>Kontur</b><span>population, H3 resolution 8</span><i>CC BY 4.0</i></li>
          <li><b>OpenStreetMap</b><span>hospitals, power, schools, industry, road and rail</span><i>ODbL</i></li>
          <li><b>Open-Meteo / ERA5</b><span>daily weather, plus ten years of archive for the baseline</span><i>CC BY 4.0</i></li>
          <li><b>geoBoundaries / IGN</b><span>national and provincial boundaries</span><i>CC BY 4.0</i></li>
        </ul>
        <p className="lp-caveat">
          <b>What it is not.</b> The fuel layer is land <em>cover</em>, not biomass — it knows
          what grows, not how much. And the model measures how readily a place would burn if
          something ignited it, not how likely an ignition is. Both are stated in the app.
        </p>
      </section>

      <footer className="lp-foot">
        <button className="lp-enter" onClick={onEnter}>Open the live map</button>
        <p>
          Built for HackBarna 2026 · data prepared {f ? f.stamp : ''} ·
          {' '}<a href="https://github.com/abdullahalsaidi16/grootguard"
                  target="_blank" rel="noopener noreferrer">github.com/abdullahalsaidi16/grootguard</a>
        </p>
      </footer>
    </div>
  )
}
