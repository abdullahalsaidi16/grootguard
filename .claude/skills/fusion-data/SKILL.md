---
name: fusion-data
description: Schema, provenance and gotchas for the FUSION prepared datasets in data/prepared/ (H3 grid, fuel, population, assets, places, weather, joined cells). Use whenever reading, regenerating, extending or debugging FUSION's data, or when a number shown in the app needs to be traced back to its source.
---

# FUSION prepared datasets

Everything the app reads lives in `data/prepared/` as JSON, and is **committed** (C6).
Raw downloads live in `data/raw/` and derivable intermediates in `data/interim/`; both are
gitignored. `app/public/data/` is a generated copy — never edit it, it is wiped and
restaged by `app/scripts/stage-data.mjs` on every dev/build run.

Regenerate with `.venv/bin/python -m pipeline.<stage>`. Order matters:

```
grid → population → fuel → assets → places → weather → consequence
```

## The one rule that matters

**Every number the app displays traces to a public dataset or to a named constant in
`constants.json`.** Nothing is estimated, interpolated from memory, or filled in to look
complete (D1). If a source cannot be obtained, its term is disabled (weight 0) and the
substitution is recorded in `constants.json.data_sources` — not guessed at.

## Files

All files are **columnar**: parallel arrays indexed together, so `cells[i]`, `tree[i]` and
`pop[i]` describe the same cell. This keeps the payload small (no repeated keys).

| File | Rows | What it is |
|---|---|---|
| `grid.json` | 14,002 | H3 res-6 cell indices covering peninsular Spain + Balearics |
| `fuel.json` | 14,002 | tree/shrub/grass cover fractions, land fraction, res-8 exposed population |
| `population.json` | 13,918 | Kontur population summed to res 6 |
| `assets.json` | 8,162 | per-class asset counts + named features per cell |
| `places.json` | 14,002 | `{cell: [settlement name or null, province or null]}` |
| `weather_points.json` | 66 | H3 res-3 weather sampling points + lat/lon |
| `weather_current.json` | 66 | this week / last week `W` and `M`, with a UTC timestamp |
| `weather_history.json` | 66 × 523 | weekly `[W, M]` per ISO week, 2016–2025 |
| **`cells.json`** | 14,002 | **the join the app actually loads** — everything above, merged |

### `cells.json` fields

| Field | Meaning |
|---|---|
| `cells[]` | H3 res-6 index (string) |
| `tree/shrub/grass[]` | cover fraction **of land**, 0–1 (not of total cell area) |
| `land_frac[]` | share of the cell that is land at all |
| `area_ha[]` | land area in hectares (`cell_area × land_frac × 100`) |
| `pop[]` | residents |
| `pop_exposed[]` | wildland-exposed residents — **computed at res 8**, see below |
| `pop10km[]` | population within the cascade radius (H3 k-ring 2) |
| `C[]` | consequence score |
| `asset_score[]` | capped asset contribution to `C` |
| `assets[][]` | counts per class, ordered by `asset_classes` |
| `top_asset[]` | index into `asset_classes` of the highest-scoring class, or −1 |
| `top_asset_name[]` | OSM name of that feature, or null |
| `name[]`, `province[]` | settlement name (may be null) and province |
| `wpt[]` | index into `weather_points[]` |
| `synthetic` | **present and `true` only when mock data is in play** (D3) |

Join weather **by point id**, not array position:
`weather_points[wpt[i]]` → look that id up in `weather_current.points`. The two files can be
regenerated independently, so positional joins can silently shift.

## Gotchas that will bite you

1. **`pop_exposed` is computed at res 8, not res 6.** §9.3 states dense city cores should
   score near zero; applied to a 36 km² res-6 cell they scored **41%** exposed, because a
   city cell's parks and suburbs lift its cover fractions. The formula and constants are
   unchanged — it is evaluated per res-8 sub-cell (Kontur's native resolution) in
   `fuel.py` and summed population-weighted. Do not recompute it from res-6 `tree/shrub/grass`.
2. **The grid includes cells that only *intersect* Spain.** Centre-containment alone dropped
   523 coastal cells holding **2.63M people** — Badalona, Santander, A Coruña, San Sebastián,
   i.e. exactly the Mediterranean/Atlantic WUI. `grid.py` adds any neighbouring cell whose
   hexagon overlaps land.
3. **Foreign features are clipped out.** The Overpass bbox spans Portugal, France, Andorra
   and Morocco; combined with border cells, a French town once ranked 9th nationally.
   `spain.py` filters assets and place nodes to Spain. **Fuel is *not* clipped** — a border
   cell's WorldCover fractions still include foreign land.
4. **`rail_motorway` counts distinct corridors, not OSM ways.** OSM splits one motorway into
   a new way at every tag change; counting ways gave a median of 13 and a max of 859 per
   cell, enough to peg the class cap and make a road outrank a hospital. Identity is the
   route `ref` ("AP-7"), falling back to name, then mode.
5. **Cover fractions are a spatial sample**, ~5,600 points per cell, read from WorldCover
   overview level 8 (80 m). The overviews were verified to use mode/nearest resampling — an
   *averaged* overview would yield invalid class codes. Never read them assuming averaging.
6. **`F` is land cover, not biomass.** No tonnes/ha, canopy height, density or species.
   A sparse dehesa and a dense pine plantation both read `tree = 1.0`.
7. **The `h3` Python library renamed its API in v4** (`latlng_to_cell`, `cell_to_latlng`,
   `grid_disk`, `cell_to_boundary`). `h3-js` in the app is pinned to the same major version
   so indices are interchangeable.
8. **Overpass and Open-Meteo rate-limit hard.** Both clients cache per tile / per point and
   retry with backoff, so a failed run resumes rather than restarting. A full weather fetch
   can take several attempts; `pipeline/weather.py` is safe to re-run in a loop.

## Provenance

Licences and attribution for every source are in the README and in `constants.json`
under `data_sources`, which also records the two **substitutions**: the EFFIS endpoint in
the brief is dead (`msLoadMap(): Unable to access file`) and the Copernicus-hosted one is
used instead; Natura 2000 and broadleaf share were not obtained, so both terms carry
weight 0 rather than being estimated.

## Synthetic data

`pipeline/mock.py` fills in only datasets that do not yet exist, so app work can start
before the slow sources land. Anything it writes carries `"synthetic": true`, which
propagates into `cells.json` and raises a red banner in the app. **No synthetic data on the
demo path** — delete the file and run the real stage.
