"""Consequence score C per cell, and the joined dataset the app loads
(PRD §9.3, deliverable §10.2).

C is static - it depends on fuel, people and assets, none of which change with
weather or budget - so it is computed once here rather than in the browser.
The app combines it with W and M to get COMBUSTION and PRIORITY.

    expF        = clamp((F - 0.05) x 1.6, 0.03, 1)
    pop_exposed = pop x expF
    C           = pop_exposed/8000
                + 0.5 x (neighbours' pop_exposed)/8000
                + sum of capped asset-class scores
                + natura_weight x natura_fraction        (weight 0: no source)

Power plants and substations additionally carry the cascade term,
0.002 x population within ~10 km. That is a PROXIMITY measure: the model does
not trace which people are actually supplied by which asset, and the app's
wording must not claim that it does (F5).

Output: data/out/cells.json - everything the app needs, columnar.
"""
from __future__ import annotations

import h3
import numpy as np

from .common import CONSTANTS, OUT, log, read_json, write_json


def cascade_k(res: int, radius_km: float) -> int:
    """How many H3 rings approximate the cascade radius."""
    edge = h3.average_hexagon_edge_length(res, "km")
    centre_spacing = edge * (3 ** 0.5)  # centre-to-centre of adjacent cells
    return max(1, round(radius_km / centre_spacing))


def main() -> None:
    c = CONSTANTS
    res = c.get("grid.h3_resolution")
    wres = c.get("grid.weather_h3_resolution")

    grid = read_json(OUT / "grid.json")["cells"]
    fuel = read_json(OUT / "fuel.json")
    pop_d = read_json(OUT / "population.json")
    assets = read_json(OUT / "assets.json")
    places = read_json(OUT / "places.json")

    fuel_i = {k: i for i, k in enumerate(fuel["cells"])}
    pop = dict(zip(pop_d["cells"], pop_d["population"]))
    acls = assets["classes"]
    acount = {k: v for k, v in zip(assets["cells"], assets["counts"])}
    named = assets.get("named", {})

    w_tree = c.get("fuel.w_tree"); w_shrub = c.get("fuel.w_shrub")
    w_grass = c.get("fuel.w_grass")
    norm = c.get("consequence.pop_normaliser")
    nbw = c.get("consequence.neighbour_weight")
    scores = c.get("consequence.asset_scores")
    cap = c.get("consequence.asset_class_cap")
    casc_coef = c.get("consequence.cascade_coefficient")
    casc_cls = set(c.get("consequence.cascade_applies_to"))
    natura_w = c.get("consequence.natura_weight")

    k = cascade_k(res, c.get("consequence.cascade_radius_km"))
    log(f"cascade radius {c.get('consequence.cascade_radius_km')} km -> k-ring {k}")

    # --- fuel index and exposed population, for every cell ---
    F, popex, area_ha, landf = {}, {}, {}, {}
    for cell in grid:
        i = fuel_i.get(cell)
        if i is None:
            continue
        f = (w_tree * fuel["tree"][i] + w_shrub * fuel["shrub"][i]
             + w_grass * fuel["grass"][i])
        F[cell] = f
        lf = fuel["land_frac"][i]
        landf[cell] = lf
        area_ha[cell] = h3.cell_area(cell, "km^2") * lf * 100.0
        # §9.3's exposure fraction is evaluated per res-8 sub-cell in fuel.py and
        # summed here, population-weighted. Applying it to a 36 km2 res-6 average
        # instead would credit a city's parks and suburbs to its dense core, which
        # is why major-city cells were scoring ~41% exposed rather than near zero.
        popex[cell] = fuel["pop_exposed"][i]

    # --- population within the cascade radius, for the power-asset term ---
    pop10 = {}
    for cell in grid:
        pop10[cell] = sum(pop.get(n, 0.0) for n in h3.grid_disk(cell, k))

    # --- consequence ---
    out = {key: [] for key in
           ("cells", "tree", "shrub", "grass", "land_frac", "area_ha", "pop",
            "pop_exposed", "pop10km", "C", "asset_score", "assets",
            "top_asset", "top_asset_name", "name", "province", "wpt")}
    wpts = sorted({h3.cell_to_parent(x, wres) for x in grid})
    wpt_i = {p: i for i, p in enumerate(wpts)}

    n_nodata = 0
    for cell in grid:
        if cell not in F:
            n_nodata += 1
            continue  # F3: no fuel data -> not shown as low priority, shown as no-data

        counts = acount.get(cell, [0] * len(acls))
        # Per-class score, capped (PRD §9.3), with the cascade term applied to
        # power assets only.
        per_class, best = [], (-1.0, -1)
        for j, cls in enumerate(acls):
            n = counts[j]
            if n == 0:
                per_class.append(0.0)
                continue
            unit = scores[cls]
            if cls in casc_cls:
                unit += casc_coef * pop10[cell]
            s = min(n * unit, cap)
            per_class.append(s)
            if s > best[0]:
                best = (s, j)
        asset_score = sum(per_class)

        nb = sum(popex.get(n, 0.0) for n in h3.grid_ring(cell, 1))
        C = (popex[cell] / norm + nbw * nb / norm + asset_score
             + natura_w * 0.0)  # natura_fraction unavailable -> weight 0 (D2)

        nm = None
        if best[1] >= 0:
            want = acls[best[1]]
            for entry in named.get(cell, []):
                if entry["c"] == want:
                    nm = entry["n"]
                    break

        pl = places.get(cell, [None, None])
        i = fuel_i[cell]
        out["cells"].append(cell)
        out["tree"].append(fuel["tree"][i])
        out["shrub"].append(fuel["shrub"][i])
        out["grass"].append(fuel["grass"][i])
        out["land_frac"].append(landf[cell])
        out["area_ha"].append(round(area_ha[cell], 1))
        out["pop"].append(round(pop.get(cell, 0.0), 1))
        out["pop_exposed"].append(round(popex[cell], 1))
        out["pop10km"].append(round(pop10[cell], 0))
        out["C"].append(round(C, 4))
        out["asset_score"].append(round(asset_score, 3))
        out["assets"].append(counts)
        out["top_asset"].append(best[1])
        out["top_asset_name"].append(nm)
        out["name"].append(pl[0])
        out["province"].append(pl[1])
        out["wpt"].append(wpt_i[h3.cell_to_parent(cell, wres)])

    out["asset_classes"] = acls
    out["weather_points"] = wpts
    # D3: synthetic provenance propagates into the joined file, which is what
    # raises the banner in the app.
    if assets.get("synthetic") or places.get("synthetic"):
        out["synthetic"] = True
        log("WARNING: inputs are SYNTHETIC - cells.json flagged for the banner (D3)")

    Ca = np.array(out["C"])
    Fa = (np.array(out["tree"]) * w_tree + np.array(out["shrub"]) * w_shrub
          + np.array(out["grass"]) * w_grass)
    log(f"cells: {len(out['cells']):,} with data, {n_nodata} no-data (F3)")
    log(f"C: mean {Ca.mean():.2f} median {np.median(Ca):.2f} "
        f"p99 {np.percentile(Ca,99):.1f} max {Ca.max():.1f}")
    log(f"F: mean {Fa.mean():.3f}; burnable {100*(Fa>c.get('fuel.burnable_threshold')).mean():.1f}%")
    log(f"exposed population total: {sum(out['pop_exposed'])/1e6:.2f}M")
    write_json(out, OUT / "cells.json")


if __name__ == "__main__":
    main()
