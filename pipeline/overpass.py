"""Tiled, cached, retrying Overpass client.

A single Spain-wide query for even a light class (amenity=hospital) returns
HTTP 504 from the public server, so every selector is instead fetched over a
grid of sub-bounding-boxes. Each tile is cached on disk (C6), so a re-run or a
crash resumes instead of re-fetching, and the public endpoint is never asked
for more than one tile at a time (PRD §11.6).
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import requests

from .common import RAW, USER_AGENT, log

ENDPOINT = "https://overpass-api.de/api/interpreter"
# minlon, minlat, maxlon, maxlat for peninsular Spain + the Balearics.
SPAIN = (-9.9, 35.8, 4.6, 44.0)
TILE_DEG = 2.0
PAUSE_S = 4
# The public endpoint answers 429 (rate limit) and 504 (query too heavy) freely.
# Both are transient, so back off far rather than failing the run - every tile
# is cached, so even a restart keeps whatever already landed.
MAX_RETRIES = 8
MAX_BACKOFF_S = 90
CACHE = RAW / "overpass"


def tiles(step: float = TILE_DEG):
    x0, y0, x1, y1 = SPAIN
    out = []
    y = y0
    while y < y1:
        x = x0
        while x < x1:
            out.append((round(x, 3), round(y, 3),
                        round(min(x + step, x1), 3), round(min(y + step, y1), 3)))
            x += step
        y += step
    return out


def _fetch(selector: str, out_mode: str, bbox, cache_path: Path) -> dict:
    if cache_path.exists() and cache_path.stat().st_size > 0:
        return json.loads(cache_path.read_text())

    x0, y0, x1, y1 = bbox
    # `selector` is a union body: one query returns every class for this tile,
    # which is what keeps the request count down.
    # Overpass bbox order is south,west,north,east.
    q = (f"[out:json][timeout:240][bbox:{y0},{x0},{y1},{x1}];\n"
         f"{selector}\nout {out_mode};")

    delay = 5
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.post(ENDPOINT, data={"data": q}, timeout=400,
                              headers={"User-Agent": USER_AGENT})
        except requests.RequestException as exc:
            log(f"        network error ({type(exc).__name__}), retry in {delay}s")
            time.sleep(delay)
            delay = min(delay * 2, MAX_BACKOFF_S)
            continue
        if r.status_code == 200:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_bytes(r.content)
            return json.loads(r.content)
        if r.status_code in (429, 504, 502, 503):
            log(f"        HTTP {r.status_code} (attempt {attempt}/{MAX_RETRIES}), "
                f"retry in {delay}s")
            time.sleep(delay)
            delay = min(delay * 2, MAX_BACKOFF_S)
            continue
        raise SystemExit(f"Overpass {r.status_code}: {r.text[:300]}")
    raise SystemExit(f"Overpass gave up after {MAX_RETRIES} attempts on {bbox}")


def fetch_all(name: str, selector: str, out_mode: str = "center") -> list[dict]:
    """Fetch a selector across all of Spain, tile by tile, and return elements."""
    elements: list[dict] = []
    tl = tiles()
    hits = 0
    for i, bbox in enumerate(tl, 1):
        cache_path = CACHE / name / f"{bbox[0]}_{bbox[1]}.json"
        fresh = not cache_path.exists()
        data = _fetch(selector, out_mode, bbox, cache_path)
        els = data.get("elements", [])
        elements.extend(els)
        hits += len(els)
        log(f"  {name} tile {i}/{len(tl)} {bbox[0]},{bbox[1]}: "
            f"{len(els):,} elements{'' if fresh else ' (cached)'}")
        if fresh and i < len(tl):
            time.sleep(PAUSE_S)
    log(f"{name}: {hits:,} elements over {len(tl)} tiles")
    return elements
