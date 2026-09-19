"""Build the H3 res-6 analysis grid for peninsular Spain + the Balearics (PRD F1).

Output: data/out/grid.json  -> {"cells": [h3 index, ...], "bbox": [...]}
The app derives every hexagon outline from these indices with h3-js, so no
polygon geometry is ever shipped.
"""
from __future__ import annotations

import json

import h3

from .common import CONSTANTS, OUT, RAW, download, log, write_json

GEOBOUNDARIES_API = "https://www.geoboundaries.org/api/current/gbOpen/ESP/ADM0/"

# PRD F1 scopes the product to peninsular Spain and the Balearics. Spain's ADM0
# boundary also contains the Canary Islands (~28 N, 16 W) plus Ceuta and Melilla
# on the African coast; those fall outside this window and are dropped.
MAINLAND_BBOX = (-9.9, 35.8, 4.6, 44.0)  # minlon, minlat, maxlon, maxlat


def fetch_boundary() -> dict:
    """Download Spain ADM0 as GeoJSON, caching both the metadata and the geometry."""
    meta_path = RAW / "geoboundaries_esp_adm0_meta.json"
    if not meta_path.exists():
        import requests

        from .common import USER_AGENT

        r = requests.get(GEOBOUNDARIES_API, timeout=60, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        meta_path.write_text(json.dumps(r.json()))
    meta = json.loads(meta_path.read_text())
    entry = meta[0] if isinstance(meta, list) else meta
    log(f"boundary: {entry['boundaryName']} / {entry['boundaryType']} "
        f"({entry['boundaryLicense']})")
    gj_path = download(entry["gjDownloadURL"], RAW / "esp_adm0.geojson")
    return json.loads(gj_path.read_text())


def _polygons(geojson: dict):
    """Yield every Polygon coordinate list in the FeatureCollection."""
    for feat in geojson.get("features", [geojson]):
        geom = feat.get("geometry", feat)
        if geom["type"] == "Polygon":
            yield geom["coordinates"]
        elif geom["type"] == "MultiPolygon":
            for poly in geom["coordinates"]:
                yield poly


def _in_window(ring) -> bool:
    """True if a ring's centroid sits inside the mainland+Balearics window."""
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    clon, clat = sum(lons) / len(lons), sum(lats) / len(lats)
    x0, y0, x1, y1 = MAINLAND_BBOX
    return x0 <= clon <= x1 and y0 <= clat <= y1


def _coastal_pass(cells: set[str], polys: list, res: int) -> set[str]:
    """Add cells that intersect the boundary without being centred on it."""
    from shapely.geometry import Polygon
    from shapely.strtree import STRtree

    shapes = [Polygon(p[0], p[1:]) for p in polys]
    tree = STRtree(shapes)

    # Candidates are the immediate neighbours of the cells we already have.
    candidates: set[str] = set()
    for c in cells:
        candidates.update(h3.grid_disk(c, 1))
    candidates -= cells
    log(f"coastal pass: testing {len(candidates)} adjacent cells for land overlap")

    added = set()
    for c in candidates:
        # cell_to_boundary returns (lat, lng); shapely wants (x=lng, y=lat).
        hexa = Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)])
        for i in tree.query(hexa):
            if shapes[i].intersects(hexa):
                added.add(c)
                break
    log(f"coastal pass: added {len(added)} cells that touch land")
    return added


def build_grid() -> dict:
    res = CONSTANTS.get("grid.h3_resolution")
    geojson = fetch_boundary()

    keep_polys = []
    cells: set[str] = set()
    kept = dropped = 0
    for poly in _polygons(geojson):
        outer = poly[0]
        if not _in_window(outer):
            dropped += 1
            continue
        kept += 1
        keep_polys.append(poly)
        # h3.geo_to_cells takes GeoJSON-style geometry (lng, lat order) and
        # returns every cell whose CENTRE falls inside the polygon.
        shape = h3.geo_to_cells({"type": "Polygon", "coordinates": poly}, res)
        cells.update(shape)

    log(f"polygons kept={kept} dropped_outside_window={dropped}")
    log(f"centre-containment pass: {len(cells)} cells")

    # Centre-containment alone drops every coastal cell whose centre happens to
    # fall offshore - which in Spain means Badalona, Santander, A Coruna, San
    # Sebastian and much of the Mediterranean WUI, ~2.6M people and some of the
    # highest-consequence land in the country. So take a second pass and keep
    # any neighbouring cell whose hexagon actually INTERSECTS the boundary.
    cells |= _coastal_pass(cells, keep_polys, res)

    cell_list = sorted(cells)
    log(f"grid: {len(cell_list)} cells at res {res} "
        f"(~{h3.average_hexagon_area(res, 'km^2'):.1f} km^2 each)")

    return {
        "resolution": res,
        "count": len(cell_list),
        "cells": cell_list,
    }


def main() -> None:
    grid = build_grid()
    write_json(grid, OUT / "grid.json")


if __name__ == "__main__":
    main()
