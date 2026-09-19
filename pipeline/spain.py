"""Point-in-Spain test, used to keep foreign features out of border cells.

The Overpass bounding box necessarily covers Portugal, southern France, Andorra
and northern Morocco, and the grid deliberately includes cells that merely
*intersect* Spain (that is what recovers the coastal WUI). Together those two
facts let a French or Portuguese town name a Spanish cell - "Bagnères-de-Luchon,
Lleida" was ranked 9th nationally before this was added.

Testing every feature against the full boundary would be slow, so cells whose
whole hexagon lies inside Spain are resolved once and their contents accepted
without a per-point test; only genuinely straddling cells pay for the geometry.
"""
from __future__ import annotations

import json

import h3
from shapely.geometry import Point, Polygon
from shapely.strtree import STRtree

from .common import RAW, log

# Mainland + Balearics window, matching grid.MAINLAND_BBOX.
WINDOW = (-9.9, 35.8, 4.6, 44.0)


class SpainMask:
    def __init__(self, geojson_path=None):
        path = geojson_path or (RAW / "esp_adm0.geojson")
        gj = json.loads(path.read_text())
        self.polys: list[Polygon] = []
        for feat in gj.get("features", [gj]):
            geom = feat.get("geometry", feat)
            coords = ([geom["coordinates"]] if geom["type"] == "Polygon"
                      else geom["coordinates"])
            for poly in coords:
                ring = poly[0]
                lons = [p[0] for p in ring]
                lats = [p[1] for p in ring]
                clon, clat = sum(lons) / len(lons), sum(lats) / len(lats)
                x0, y0, x1, y1 = WINDOW
                if x0 <= clon <= x1 and y0 <= clat <= y1:
                    self.polys.append(Polygon(poly[0], poly[1:]))
        self.tree = STRtree(self.polys)
        self._cell_interior: dict[str, bool] = {}
        log(f"spain mask: {len(self.polys)} boundary polygons")

    def contains(self, lon: float, lat: float) -> bool:
        p = Point(lon, lat)
        for i in self.tree.query(p):
            if self.polys[i].contains(p):
                return True
        return False

    def cell_is_interior(self, cell: str) -> bool:
        """True when every vertex of the hexagon is inside Spain."""
        hit = self._cell_interior.get(cell)
        if hit is None:
            hit = all(self.contains(lng, lat) for lat, lng in h3.cell_to_boundary(cell))
            self._cell_interior[cell] = hit
        return hit

    def accept(self, lon: float, lat: float, cell: str) -> bool:
        """Cheap path for interior cells, exact test only on border cells."""
        if self.cell_is_interior(cell):
            return True
        return self.contains(lon, lat)
