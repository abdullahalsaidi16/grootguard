"""Per-cell fuel cover fractions from ESA WorldCover 10 m (PRD §9.1).

Reading WorldCover at native 10 m for all of Spain is ~10^10 pixels (PRD §11.6),
so we read the COG overview at 80 m instead. The overviews were verified to use
mode/nearest resampling, meaning every value is still a real class code - an
averaged overview would have produced meaningless codes.

Method: for each 3-degree tile, read the 80 m overview, reduce it in 4x4 blocks
(~320 m) carrying a full class histogram per block, then bin each block centroid
into its H3 res-6 cell. The histogram is what is accumulated, so fractions stay
exact at the 80 m sampling level while the number of H3 lookups drops 16-fold.

Output: data/out/fuel.json -> per-cell tree / shrub / grass fractions of LAND,
plus land_frac (share of the cell that is land at all) and the sample count.
"""
from __future__ import annotations

import os
from collections import defaultdict

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
os.environ.setdefault("VSI_CACHE", "TRUE")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "5")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")

import h3
import numpy as np
import rasterio

from .common import CONSTANTS, INTERIM, OUT, log, read_json, write_json

BUCKET = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map"
NATIVE_RES_DEG = 1.0 / 12000.0  # 10 m tiles: 36000 px across 3 degrees
TILE_DEG = 3
# 2 x 80 m = 160 m blocks. Finer than strictly needed for res 6, but a res-8
# cell is only ~0.74 km2 and still gets ~29 samples at this spacing.
BLOCK = 2


def tile_name(lat0: int, lon0: int) -> str:
    ns = f"N{lat0:02d}" if lat0 >= 0 else f"S{abs(lat0):02d}"
    ew = f"E{lon0:03d}" if lon0 >= 0 else f"W{abs(lon0):03d}"
    return f"ESA_WorldCover_10m_2021_v200_{ns}{ew}_Map.tif"


def tiles_for_cells(cells: list[str]) -> set[tuple[int, int]]:
    """The set of 3-degree tiles actually touched by the grid."""
    needed = set()
    for c in cells:
        lat, lon = h3.cell_to_latlng(c)
        needed.add((int(np.floor(lat / TILE_DEG) * TILE_DEG),
                    int(np.floor(lon / TILE_DEG) * TILE_DEG)))
    return needed


def process_tile(lat0: int, lon0: int, res8: int, acc8: dict, classes: dict) -> bool:
    url = f"/vsicurl/{BUCKET}/{tile_name(lat0, lon0)}"
    try:
        ds = rasterio.open(url)
    except Exception as exc:  # ocean-only tiles are simply not published
        log(f"skip    {tile_name(lat0, lon0)} ({type(exc).__name__})")
        return False

    with ds:
        ov = CONSTANTS.get("fuel.sample_resolution_m") // 10  # 80 m -> overview 8
        n = ds.width // ov
        log(f"read    {tile_name(lat0, lon0)} at {n}x{n} ({ov*10} m)")
        a = ds.read(1, out_shape=(1, n, n))

    px = NATIVE_RES_DEG * ov  # degrees per sampled pixel
    nb = n // BLOCK
    a = a[: nb * BLOCK, : nb * BLOCK]

    # Class histograms per 320 m block.
    def block_sum(mask: np.ndarray) -> np.ndarray:
        return mask.reshape(nb, BLOCK, nb, BLOCK).sum(axis=(1, 3), dtype=np.int32)

    valid = block_sum(a != 0)          # 0 = WorldCover no-data (sea, off-tile)
    counts = {k: block_sum(a == code) for k, code in classes.items()}

    # Block centroids. Row 0 is the northern edge of the tile.
    rows = np.arange(nb)
    cols = np.arange(nb)
    lats = (lat0 + TILE_DEG) - (rows + 0.5) * px * BLOCK
    lons = lon0 + (cols + 0.5) * px * BLOCK

    nz = np.argwhere(valid > 0)
    log(f"        {len(nz):,} land blocks -> H3 res {res8}")
    latlng_to_cell = h3.latlng_to_cell
    tree, shrub, grass = counts["tree"], counts["shrub"], counts["grass"]
    per_block = BLOCK * BLOCK

    for r, c in nz:
        cell = latlng_to_cell(float(lats[r]), float(lons[c]), res8)
        e = acc8[cell]
        e[0] += int(tree[r, c])
        e[1] += int(shrub[r, c])
        e[2] += int(grass[r, c])
        e[3] += int(valid[r, c])
        e[4] += per_block
    return True


def main() -> None:
    res = CONSTANTS.get("grid.h3_resolution")
    res8 = 8  # Kontur's native resolution, and the scale at which §9.3's
              # "dense city core" is a meaningful unit rather than a 36 km2 average.
    classes = CONSTANTS.get("fuel.worldcover_classes")
    cells = read_json(OUT / "grid.json")["cells"]
    wanted = set(cells)

    tiles = sorted(tiles_for_cells(cells))
    log(f"{len(tiles)} WorldCover tiles cover the grid")

    # [tree_px, shrub_px, grass_px, land_px, total_px] keyed by res-8 cell
    acc8: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0, 0, 0])
    got = 0
    for lat0, lon0 in tiles:
        if process_tile(lat0, lon0, res8, acc8, classes):
            got += 1
    log(f"{got}/{len(tiles)} tiles read; {len(acc8):,} populated res-8 cells")

    w_tree = CONSTANTS.get("fuel.w_tree")
    w_shrub = CONSTANTS.get("fuel.w_shrub")
    w_grass = CONSTANTS.get("fuel.w_grass")
    off = CONSTANTS.get("consequence.exposure_offset")
    slope = CONSTANTS.get("consequence.exposure_slope")
    emin = CONSTANTS.get("consequence.exposure_min")
    emax = CONSTANTS.get("consequence.exposure_max")

    # --- roll res-8 counts up to the res-6 analysis cell ---
    # res 8 nests exactly inside res 6, so this is a sum, not a resampling.
    acc6: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0, 0, 0])
    parent: dict[str, str] = {}
    for c8, e in acc8.items():
        p6 = h3.cell_to_parent(c8, res)
        parent[c8] = p6
        if p6 not in wanted:
            continue
        t = acc6[p6]
        for k in range(5):
            t[k] += e[k]

    # --- §9.3 exposure, evaluated per res-8 cell then population-weighted ---
    pop8 = read_json(INTERIM / "population_res8.json")
    exposed6: dict[str, float] = defaultdict(float)
    pop_no_fuel = 0.0
    for c8, p in zip(pop8["cells"], pop8["population"]):
        e = acc8.get(c8)
        p6 = parent.get(c8) or h3.cell_to_parent(c8, res)
        if p6 not in wanted:
            continue
        if e is None or e[3] == 0:
            pop_no_fuel += p
            continue
        land = e[3]
        f8 = (w_tree * e[0] + w_shrub * e[1] + w_grass * e[2]) / land
        exposed6[p6] += p * min(max((f8 - off) * slope, emin), emax)

    out = {"cells": [], "tree": [], "shrub": [], "grass": [],
           "land_frac": [], "samples": [], "pop_exposed": []}
    missing = 0
    for c in cells:
        e = acc6.get(c)
        if e is None or e[3] == 0:
            missing += 1
            continue  # F3: no fuel data -> shown as no-data, not as low priority
        land = e[3]
        out["cells"].append(c)
        out["tree"].append(round(e[0] / land, 4))
        out["shrub"].append(round(e[1] / land, 4))
        out["grass"].append(round(e[2] / land, 4))
        out["land_frac"].append(round(land / e[4], 4))
        out["samples"].append(land)
        out["pop_exposed"].append(round(exposed6.get(c, 0.0), 1))

    n = len(out["cells"])
    log(f"fuel: {n} cells with data, {missing} without (F3 no-data)")
    if n:
        f = (np.array(out["tree"]) * w_tree + np.array(out["shrub"]) * w_shrub
             + np.array(out["grass"]) * w_grass)
        thr = CONSTANTS.get("fuel.burnable_threshold")
        log(f"fuel index F: mean {f.mean():.3f}  median {np.median(f):.3f}  max {f.max():.3f}")
        log(f"burnable (F > {thr}): {(f > thr).sum()} cells ({100*(f>thr).mean():.1f}%)")
        log(f"exposed population (res-8 evaluation): "
            f"{sum(out['pop_exposed'])/1e6:.2f}M")
        if pop_no_fuel:
            log(f"  {pop_no_fuel/1e3:.0f}k people in res-8 cells with no WorldCover land "
                f"(fully built-over) -> zero exposure")
    write_json(out, OUT / "fuel.json")


if __name__ == "__main__":
    main()
