"""Place name and province per cell (PRD F4, §7.2).

Province comes from geoBoundaries ESP ADM2 (source: Instituto Nacional de
Estadistica) by point-in-polygon on the cell centroid. Place name comes from
OSM place=city/town/village; where a cell contains no settlement the PRD
fallback applies and only the province is shown.

Output: data/out/places.json -> {cell: [name|null, province|null]}
"""
from __future__ import annotations

import json

import h3

from .common import CONSTANTS, INTERIM, OUT, RAW, USER_AGENT, download, log, read_json, write_json

ADM2_API = "https://www.geoboundaries.org/api/current/gbOpen/ESP/ADM2/"
# city > town > village: the more significant settlement names the cell.
RANK = {"city": 3, "town": 2, "village": 1}


def province_lookup(cells: list[str]) -> dict[str, str]:
    meta_path = RAW / "geoboundaries_esp_adm2_meta.json"
    if not meta_path.exists():
        import requests
        r = requests.get(ADM2_API, timeout=60, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        meta_path.write_text(json.dumps(r.json()))
    meta = json.loads(meta_path.read_text())
    entry = meta[0] if isinstance(meta, list) else meta
    log(f"provinces: {entry['boundaryType']} from {entry['boundarySource']}")
    gj = json.loads(download(entry["gjDownloadURL"], RAW / "esp_adm2.geojson").read_text())

    from shapely.geometry import Point, Polygon, shape
    from shapely.strtree import STRtree

    shapes, names = [], []
    for feat in gj["features"]:
        nm = (feat["properties"].get("shapeName") or "").strip()
        geom = shape(feat["geometry"])
        shapes.append(geom)
        names.append(nm)
    tree = STRtree(shapes)
    log(f"provinces: {len(shapes)} ADM2 polygons")

    out: dict[str, str] = {}
    unmatched = []
    for c in cells:
        lat, lng = h3.cell_to_latlng(c)
        pt = Point(lng, lat)
        for i in tree.query(pt):
            if shapes[i].contains(pt):
                out[c] = names[i]
                break
        else:
            unmatched.append((c, pt))

    # Coastal cells whose centroid sits just offshore fall outside every
    # province polygon; attribute them to the nearest one instead of dropping.
    if unmatched:
        for c, pt in unmatched:
            i = tree.nearest(pt)
            out[c] = names[i]
        log(f"provinces: {len(unmatched)} offshore-centroid cells snapped to nearest")
    log(f"provinces: {len(set(out.values()))} distinct provinces assigned")
    return out


def main() -> None:
    res = CONSTANTS.get("grid.h3_resolution")
    cells = read_json(OUT / "grid.json")["cells"]
    grid = set(cells)

    prov = province_lookup(cells)

    # Settlement nodes come from the same union query assets.py already ran,
    # so no extra Overpass traffic is needed here.
    best: dict[str, tuple] = {}
    for el in read_json(INTERIM / "places_raw.json"):
        nm = el.get("name")
        if not nm:
            continue
        cell = h3.latlng_to_cell(el["lat"], el["lon"], res)
        if cell not in grid:
            continue
        try:
            pop = int(str(el.get("population") or "0").replace(" ", "").replace(",", ""))
        except ValueError:
            pop = 0
        key = (RANK.get(el.get("place"), 0), pop)
        if cell not in best or key > best[cell][0]:
            best[cell] = (key, nm)

    out = {c: [best[c][1] if c in best else None, prov.get(c)] for c in cells}
    named = sum(1 for v in out.values() if v[0])
    log(f"places: {named:,}/{len(cells):,} cells have a settlement name; "
        f"the rest fall back to province only")
    write_json(out, OUT / "places.json")


if __name__ == "__main__":
    main()
