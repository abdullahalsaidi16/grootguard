"""Per-cell population from Kontur Population Spain (PRD §7.2).

Kontur ships population on H3 res 8. Res 8 nests exactly inside res 6 (7 cells
per step, two steps => 49 children), so aggregation is an exact sum via
h3.cell_to_parent - no interpolation and no area weighting is involved.

Output: data/out/population.json -> {cell: population}
"""
from __future__ import annotations

from collections import defaultdict

import h3
import pyogrio
from pyogrio.raw import read as pyogrio_read

from .common import CONSTANTS, INTERIM, OUT, RAW, download, log, read_json, write_json

KONTUR_URL = ("https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/"
              "kontur_datasets/kontur_population_ES_20231101.gpkg.gz")


def main() -> None:
    res = CONSTANTS.get("grid.h3_resolution")
    gpkg = download(KONTUR_URL, RAW / "kontur_population_ES.gpkg", decompress_gz=True)

    info = pyogrio.read_info(gpkg)
    log(f"kontur layer: {info['features']:,} features, fields={list(info['fields'])}")

    # Attributes only - the H3 index already carries the location, so the
    # geometry is never needed. The raw reader avoids a geopandas dependency.
    meta, _, _, field_data = pyogrio_read(gpkg, read_geometry=False)
    names = [str(f) for f in meta["fields"]]
    if "h3" not in names or "population" not in names:
        raise SystemExit(f"unexpected Kontur schema: {names}")
    h3_idx = field_data[names.index("h3")]
    pop_idx = field_data[names.index("population")]

    src_res = h3.get_resolution(str(h3_idx[0]))
    log(f"source resolution {src_res} -> aggregating to res {res}")

    agg: dict[str, float] = defaultdict(float)
    cell_to_parent = h3.cell_to_parent
    for idx, pop in zip(h3_idx, pop_idx):
        agg[cell_to_parent(idx, res)] += float(pop)

    grid_cells = read_json(OUT / "grid.json")["cells"]
    out_cells, out_pop = [], []
    for c in grid_cells:
        p = agg.get(c)
        if p is None:
            continue  # no Kontur coverage -> left empty (D2/F3)
        out_cells.append(c)
        out_pop.append(round(p, 1))

    total_grid = sum(out_pop)
    total_src = float(sum(pop_idx))
    log(f"population: {len(out_cells)} cells carry people; "
        f"{total_grid/1e6:.2f}M on-grid of {total_src/1e6:.2f}M in the source "
        f"({100*total_grid/total_src:.1f}% - the remainder is the Canaries, "
        f"Ceuta and Melilla, which are out of scope)")
    log(f"max cell population: {max(out_pop):,.0f}")

    write_json({"cells": out_cells, "population": out_pop}, OUT / "population.json")

    # Kontur is natively res 8. Keep that table: §9.3's exposure fraction is
    # evaluated at res 8, where "dense city core" is a meaningful unit, before
    # being aggregated back to the res-6 analysis cell.
    src_cells = [str(x) for x in h3_idx]
    write_json({"resolution": src_res, "cells": src_cells,
                "population": [round(float(p), 1) for p in pop_idx]},
               INTERIM / "population_res8.json")


if __name__ == "__main__":
    main()
