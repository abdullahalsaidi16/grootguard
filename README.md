# FUSION

**A web map of Spain that fuses fuel, current weather and consequence-of-loss into one
ranked prevention priority per area, and turns a prevention budget into an allocation
across real prevention instruments.**

Built for the HackBarna 2026 wildfire track. Spain burned 393,079 ha in 2025 (EFFIS), with
8 deaths and ~36,000 evacuations. Public maps exist for fuel, fire weather, infrastructure
and population, but each is published separately — a civil-protection planner has no single
view that ranks places by *what would be lost if they burned*.

---

## Running it

Two halves: a Python pipeline that prepares data ahead of time, and a static React app that
reads the prepared files. There is no backend, no API key and no account (C1).

### 1. Data pipeline

```bash
uv venv --python 3.12 .venv
VIRTUAL_ENV=.venv uv pip install h3 rasterio pyogrio shapely numpy pandas requests

.venv/bin/python -m pipeline.grid         # H3 res-6 grid for Spain + Balearics
.venv/bin/python -m pipeline.population   # Kontur, res 8 -> res 6
.venv/bin/python -m pipeline.fuel         # ESA WorldCover; also res-8 exposure
.venv/bin/python -m pipeline.assets       # OpenStreetMap via Overpass  (slow: rate limited)
.venv/bin/python -m pipeline.places       # settlement names + provinces
.venv/bin/python -m pipeline.weather      # Open-Meteo forecast + 10y ERA5 archive (slow)
.venv/bin/python -m pipeline.consequence  # joins everything -> cells.json
```

Every stage is re-runnable and caches its downloads under `data/raw/` (C6). Raw downloads
are **not** committed; prepared outputs in `data/prepared/` **are**. The two slow stages
(`assets`, `weather`) hit public endpoints that rate-limit aggressively; both retry with
backoff and resume from cache, so re-running after a failure costs nothing.

`pipeline/mock.py` fills in any dataset that has not been fetched yet with clearly-marked
synthetic stand-ins, so app work can start before the slow sources land. Anything it writes
carries `"synthetic": true`, which raises a red banner in the app (D3). **No synthetic data
may be on the demo path** — delete those files and run the real stages.

### 2. App

```bash
cd app
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in app/dist/
npm test         # model tests (C7)
```

The app opens on a **landing page** explaining the problem, the model and the sources, with
its headline figures read from the prepared data at runtime so they cannot drift from it.
`#map` goes straight to the console — that is what the demo opens.

`?nobasemap=1` forces the offline style, to exercise the C3 no-network path deliberately.

### Layout

The console follows layout direction A, "Situation Board": one rail, the map taking the
rest, a plain-language answer strip above it, and the cell detail floating over the map on
selection rather than holding a column open. Measured against the first build: map area
52% -> 67%, chrome 43% -> 17% of width, ranking rows 57px -> 35px so all twenty zones fit
without scrolling, and the zone name and its score are no longer the same size.

`predev`/`prebuild` stage two things into `app/public/` (both gitignored, regenerated every
run): the prepared datasets from `data/prepared/`, and MapLibre's web worker. The worker
matters — MapLibre resolves it at runtime as a sibling of its own module, which no bundler
can see, so without staging it the built site 404s and **the map renders nothing, silently**.

### Dataset documentation

`.claude/skills/fusion-data/SKILL.md` documents every prepared file, its schema, its
provenance and the non-obvious gotchas (why exposure is computed at res 8, why the grid
includes cells that only intersect Spain, why roads count corridors rather than OSM ways).

### Deploying

The build is a folder of static files with hash routing and no backend, so any static
host works and none of them need rewrite rules. `base` is relative, so it also works from
a subpath without reconfiguration (verified against a `/grootguard/` prefix).

Deployed via **GitHub Pages**: `.github/workflows/deploy.yml` builds on every push to
`main`, runs the model tests, and publishes only if they pass. Enable it once with repo
**Settings → Pages → Source: GitHub Actions**; the site then lives at
`https://abdullahalsaidi16.github.io/grootguard/`.

Any other static host works without code changes — build command `npm run build`, base
directory `app`, output `app/dist`.

A clean checkout builds correctly — `prebuild` stages the datasets from `data/prepared/`
and the MapLibre worker from `node_modules` into `app/public/`, both of which are
gitignored by design. Built site is ~8.9 MB, of which ~5.9 MB is the prepared data.

---

## How the model works

```
PRIORITY = COMBUSTION × CONSEQUENCE
           │                        │
           │  F × W × (0.4+0.6(1−M))│  exposed people / 8,000
           │  fuel, weather, dryness│  + ½ neighbours' exposed people
           │                        │  + capped asset scores
```

Because it is a **product**, a cell needs both: bare rock with a hospital scores ~0, and
dense forest with nobody scores ~0. In the prepared data consequence and combustion are
near-independent (rank correlation **+0.089**), so the fusion genuinely does work rather
than one term dominating by construction.

Every constant lives in [`constants.json`](constants.json) — the single file that the
pipeline and the app both read, and that the in-app **Methodology** panel renders verbatim
(F18/F19). Each entry is tagged `source`, `assumption`, or `placeholder`.

### Where the model is evaluated

| Quantity | Where | Why |
|---|---|---|
| Fuel `F`, consequence `C` | pipeline | static; depends on land cover, people, assets |
| Exposure `expF` | pipeline, **at H3 res 8** | see limitations below |
| `W`, `M` | pipeline | needs per-point statistics of the ERA5 archive |
| `COMBUSTION`, `PRIORITY` | app | must move with the weather the user selects (F7) |
| Budget allocation | app | must update with no perceptible delay (F9) |

---

## Data sources, licences and attribution (D5)

| Need | Source | Licence |
|---|---|---|
| Country + province boundaries | [geoBoundaries](https://www.geoboundaries.org) gbOpen ESP ADM0/ADM2, from Instituto Geográfico Nacional / INE | CC BY 4.0 |
| Population | [Kontur Population Spain](https://data.humdata.org/dataset/kontur-population-spain) 2023-11-01, H3 res 8 | CC BY 4.0 |
| Fuel / vegetation cover | [ESA WorldCover 10 m 2021 v200](https://esa-worldcover.s3.eu-central-1.amazonaws.com/) | CC BY 4.0 |
| Critical assets, place names | [OpenStreetMap](https://www.openstreetmap.org/) via Overpass API | ODbL 1.0, © OpenStreetMap contributors |
| Weather (current + ERA5 archive) | [Open-Meteo](https://open-meteo.com/) forecast + archive APIs | CC BY 4.0; ERA5 via Copernicus |
| Basemap | [CARTO dark matter](https://carto.com/basemaps/) | © CARTO, © OpenStreetMap contributors |

Attribution is also rendered in the map's own attribution control, as D5 requires.

### Substitutions and gaps (D2)

- **EFFIS fire-danger overlay (F8).** The endpoint given in the brief
  (`ies-ows.jrc.ec.europa.eu/effis`) is **broken** — it answers
  `msLoadMap(): Unable to access file` and serves no layers. The working Copernicus-hosted
  endpoint `maps.effis.emergency.copernicus.eu` is used instead, layer `mf010.fwi`.
- **Natura 2000 protected habitat.** Not obtained (login-walled). The `6 × natura_fraction`
  term carries weight **0** rather than being estimated.
- **Broadleaf forest share.** No source identified; WorldCover has no leaf-type class.
  Term weight **0**.

---

## Known limitations

Stated plainly, because the brief asks for defensible numbers rather than complete-looking
ones (D1).

1. **This is land cover, not biomass.** `F` is the *fraction* of a cell classified as
   tree/shrub/grass. It carries no tonnes/ha, canopy height, density, dead-vs-live split or
   ladder fuels. A sparse dehesa and a dense *Pinus pinaster* plantation both read
   `tree = 1.0`. ESA CCI Biomass would be the upgrade path.
2. **Susceptibility, not ignition probability.** `COMBUSTION` answers "how readily would
   this burn if something ignited it". There is no ignition term anywhere in the model, so
   it does not know where fires actually start. Ignition detection is an explicit non-goal
   of the brief.
3. **Assets dominate consequence (~96%).** The population term averages 0.17 against the
   asset term's 19.8, because the brief divides exposed population by 8,000 (one hospital
   ≈ 80,000 exposed residents) and the per-class asset cap is an unconfirmed placeholder.
   This single constant materially shapes the ranking.
4. **Exposure is evaluated at res 8, not res 6.** The brief states dense city cores should
   score near zero, but applied to a 36 km² res-6 cell they scored **41%** exposed, because
   a city cell's parks and suburbs pull its cover fractions up. The formula and every
   constant are unchanged; it is evaluated per res-8 sub-cell (~0.74 km², Kontur's native
   resolution) and summed population-weighted, which brings Madrid's core to 22%. Still not
   "near zero" — finer resolution would go further.
5. **Cover fractions are a sample.** WorldCover is read at 80 m (overview level 8), verified
   to use mode/nearest resampling so class codes stay valid. That is ~5,600 samples per
   res-6 cell, not an exhaustive area integral.
6. **Fuel is not clipped at the border.** Assets and place names are clipped to Spain, but a
   border cell's WorldCover fractions still include French or Portuguese land.
7. **Effectiveness ranges, capacity caps, the asset-class cap, the moisture scale and the
   workforce rate are placeholders.** The team has not confirmed them. They are labelled as
   such in the Methodology panel and must not be cited.
8. **Weather is sampled on 66 points** at H3 res 3 and applied to every cell within each.
   Fire-weather fields are smooth at that scale; local terrain effects are not captured.

---

## Tests

`npm test` in `app/` covers the core model (C7): budget is never exceeded, capacity caps are
never exceeded, risk removed never decreases as budget rises, and zero budget yields an
empty allocation — plus the scoring formulas against the brief.

The allocation is a **fractional** greedy over a fixed candidate ordering, so the result for
any budget is a prefix of one ordering. That is what makes monotonicity hold by
construction rather than by luck.

---

## Repository layout

```
constants.json            every model constant + provenance (F19)
pipeline/                 Python data preparation
  grid · population · fuel · assets · places · weather · consequence
  overpass.py             tiled, cached, retrying Overpass client
  spain.py                point-in-Spain mask, keeps foreign features out
  mock.py                 synthetic stand-ins, clearly flagged (D3)
app/                      React + TypeScript + MapLibre GL JS
  src/model/              scoring, allocation, constants  (+ tests)
  src/map/                hex choropleth, validated palette
  src/ui/                 ranking, detail panel, methodology
  scripts/                stage prepared data + MapLibre worker into public/
data/prepared/            the pipeline's product, committed — the app reads this
data/raw/                 downloads, gitignored
data/interim/             derivable intermediates, gitignored
.claude/skills/fusion-data/   dataset schema, provenance and gotchas
```
