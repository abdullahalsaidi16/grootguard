"""Critical assets, and settlement names, per cell from OpenStreetMap
(PRD §7.2, §9.3, F4).

Everything OSM-derived is fetched in TWO queries per tile rather than one per
class: a union of all sited features (plus place nodes) with `out center`, and
a union of the linear features with `out geom`. Classification happens here from
the returned tags. That is what keeps the public endpoint from throttling the
run into the ground - one query per class per tile was 280 requests and did not
finish.

Two shapes of asset are handled differently, because the model asks a different
question of each:
  * sited assets are counted where they sit -> one point per feature;
  * linear assets matter wherever they run, so their geometry is walked and
    densified, and every cell they cross is credited once per way.

Outputs:
  data/out/assets.json -> per-cell counts by class + named features (F5)
  data/out/places_raw.json -> settlement nodes, consumed by places.py (F4)
"""
from __future__ import annotations

from collections import defaultdict

import h3

from .common import CONSTANTS, INTERIM, OUT, log, read_json, write_json
from .overpass import fetch_all
from .spain import SpainMask

DENSIFY_M = 400  # sample spacing along linear features

SITED_UNION = """(
  nwr["amenity"="hospital"];
  nwr["power"="plant"];
  nwr["power"="substation"];
  nwr["amenity"="school"];
  nwr["landuse"="industrial"];
  node["place"~"^(city|town|village)$"];
);"""

LINEAR_UNION = """(
  way["highway"="motorway"];
  way["railway"="rail"];
);"""


def classify(tags: dict) -> str | None:
    """Map OSM tags onto one of the PRD §9.3 asset classes (or a place node)."""
    if tags.get("amenity") == "hospital":
        return "hospital"
    if tags.get("power") == "plant":
        return "power_plant"
    if tags.get("power") == "substation":
        return "substation"
    if tags.get("amenity") == "school":
        return "school"
    if tags.get("landuse") == "industrial":
        return "industrial"
    if tags.get("place") in ("city", "town", "village"):
        return "place"
    return None


def _elem_point(el: dict):
    if "lat" in el and "lon" in el:
        return el["lat"], el["lon"]
    c = el.get("center")
    if c:
        return c["lat"], c["lon"]
    return None


def _densify(geom: list[dict], step_deg: float):
    """Yield (lat, lon) along a way, inserting points on long segments so a
    motorway is credited to every cell it crosses, not just at its vertices."""
    prev = None
    for pt in geom:
        lat, lon = pt["lat"], pt["lon"]
        if prev is not None:
            dlat, dlon = lat - prev[0], lon - prev[1]
            n = int(max(abs(dlat), abs(dlon)) / step_deg)
            for i in range(1, n + 1):
                f = i / (n + 1)
                yield prev[0] + dlat * f, prev[1] + dlon * f
        yield lat, lon
        prev = (lat, lon)


def main() -> None:
    res = CONSTANTS.get("grid.h3_resolution")
    grid = set(read_json(OUT / "grid.json")["cells"])

    # The Overpass bbox spans Portugal, France, Andorra and Morocco, and border
    # cells legitimately belong to the grid - so features must be clipped to
    # Spain or a French hospital ends up scoring a Spanish cell.
    mask = SpainMask()
    rejected = 0

    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    named: dict[str, list] = defaultdict(list)
    places: list[dict] = []

    # --- sited features + settlements, one union query per tile ---
    seen = defaultdict(int)
    for el in fetch_all("sited", SITED_UNION, "center"):
        tags = el.get("tags") or {}
        cls = classify(tags)
        p = _elem_point(el)
        if not cls or not p:
            continue
        seen[cls] += 1
        if cls == "place":
            cell0 = h3.latlng_to_cell(p[0], p[1], res)
            if cell0 not in grid or not mask.accept(p[1], p[0], cell0):
                continue
            places.append({"lat": p[0], "lon": p[1], "name": tags.get("name"),
                           "place": tags.get("place"),
                           "population": tags.get("population")})
            continue
        cell = h3.latlng_to_cell(p[0], p[1], res)
        if cell not in grid:
            continue
        if not mask.accept(p[1], p[0], cell):
            rejected += 1
            continue
        counts[cell][cls] += 1
        nm = tags.get("name")
        if nm and len(named[cell]) < 12:
            named[cell].append({"c": cls, "n": nm})
    log("fetched: " + ", ".join(f"{k}={v:,}" for k, v in sorted(seen.items())))
    log(f"clipped to Spain: {rejected:,} sited features dropped as foreign")

    # --- linear features, one union query per tile ---
    step_deg = DENSIFY_M / 111_320.0
    touched: dict[str, set] = defaultdict(set)
    nway = 0
    for el in fetch_all("linear", LINEAR_UNION, "geom"):
        geom = el.get("geometry")
        if not geom:
            continue
        nway += 1
        # Count distinct CORRIDORS, not OSM way objects. OSM splits a single
        # motorway into a new way at every tag change, so counting ways gave a
        # median of 13 and a maximum of 859 "assets" in one cell - enough to peg
        # the class cap and make a road outrank a hospital. The route reference
        # ("AP-7", "A-1") is the stable identity of the corridor; fall back to
        # its name, then to the bare mode so unnamed track still counts once.
        tags = el.get("tags") or {}
        route = (tags.get("ref") or tags.get("name")
                 or ("rail" if tags.get("railway") else "motorway"))
        for lat, lon in _densify(geom, step_deg):
            cell = h3.latlng_to_cell(lat, lon, res)
            if cell in grid and mask.accept(lon, lat, cell):
                touched[cell].add(route)
    for cell, routes in touched.items():
        # PRD §9.3 scores rail and motorway as a single class.
        counts[cell]["rail_motorway"] += len(routes)
    log(f"linear: {nway:,} ways -> distinct corridors across {len(touched):,} cells")

    cells = sorted(counts)
    classes = list(CONSTANTS.get("consequence.asset_scores").keys())
    out = {
        "classes": classes,
        "cells": cells,
        "counts": [[counts[c].get(k, 0) for k in classes] for c in cells],
        "named": {c: named[c] for c in cells if named.get(c)},
    }
    totals = {k: sum(counts[c].get(k, 0) for c in cells) for k in classes}
    log(f"assets: {len(cells):,} of {len(grid):,} cells carry at least one asset")
    log("in-grid totals: " + ", ".join(f"{k}={v:,}" for k, v in totals.items()))
    write_json(out, OUT / "assets.json")
    write_json(places, INTERIM / "places_raw.json")


if __name__ == "__main__":
    main()
