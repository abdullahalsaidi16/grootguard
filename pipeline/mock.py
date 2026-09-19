"""Synthetic stand-ins for datasets that have not finished downloading yet
(PRD §10 deliverable 1, D3).

This exists so app work can begin against the REAL grid before the slow
sources land. It only ever fills in files that are missing - fuel and
population are real from the first run and are never overwritten.

Every file written here carries "synthetic": true, which the app turns into a
visible banner. Per D3 no synthetic data may be on the demo path: delete these
files and re-run the real stages before demoing.
"""
from __future__ import annotations

import random

import h3

from .common import CONSTANTS, OUT, log, read_json, write_json

SEED = 20260919


def main() -> None:
    rnd = random.Random(SEED)
    res = CONSTANTS.get("grid.h3_resolution")
    wres = CONSTANTS.get("grid.weather_h3_resolution")
    grid = read_json(OUT / "grid.json")["cells"]
    pop = dict(zip(*(lambda d: (d["cells"], d["population"]))(
        read_json(OUT / "population.json"))))
    classes = list(CONSTANTS.get("consequence.asset_scores").keys())

    if not (OUT / "assets.json").exists():
        cells, counts, named = [], [], {}
        for c in grid:
            p = pop.get(c, 0.0)
            # More people -> more assets, with a lot of noise. Purely illustrative.
            lam = min(6.0, p / 4000.0)
            row = [0] * len(classes)
            for j, cls in enumerate(classes):
                base = lam * (0.15 if cls == "hospital" else
                              0.1 if cls == "power_plant" else
                              0.2 if cls == "substation" else
                              0.9 if cls == "school" else
                              0.4 if cls == "industrial" else 0.6)
                row[j] = int(rnd.expovariate(1 / base)) if base > 0.01 else 0
            if any(row):
                cells.append(c)
                counts.append(row)
                top = max(range(len(classes)), key=lambda j: row[j])
                if row[top]:
                    named[c] = [{"c": classes[top], "n": "SYNTHETIC facility"}]
        write_json({"synthetic": True, "classes": classes, "cells": cells,
                    "counts": counts, "named": named}, OUT / "assets.json")
        log(f"SYNTHETIC assets for {len(cells):,} cells")

    if not (OUT / "places.json").exists():
        out = {c: [None, "SYNTHETIC province"] for c in grid}
        out["synthetic"] = True
        write_json(out, OUT / "places.json")
        log("SYNTHETIC places")

    if not (OUT / "weather_current.json").exists():
        pts = sorted({h3.cell_to_parent(c, wres) for c in grid})
        lo = CONSTANTS.get("conditions.w_clamp_min")
        hi = CONSTANTS.get("conditions.w_clamp_max")

        def field(offset: float):
            # A smooth-ish south-east/north-west gradient plus noise, so the
            # map shows structure rather than static.
            W, M = [], []
            for p in pts:
                lat, lon = h3.cell_to_latlng(p)
                g = (44.0 - lat) / 8.0 * 0.7 + (lon + 9.9) / 14.5 * 0.3
                w = lo + (hi - lo) * min(1.0, max(0.0, g + offset + rnd.uniform(-0.12, 0.12)))
                W.append(round(w, 3))
                M.append(round(min(1.0, max(0.0, 1.0 - g + rnd.uniform(-0.15, 0.15))), 3))
            return W, M

        tw, tm = field(0.05)
        lw, lm = field(-0.05)
        write_json({"synthetic": True, "points": pts,
                    "this_week": {"W": tw, "M": tm},
                    "last_week": {"W": lw, "M": lm},
                    "generated_utc": "SYNTHETIC",
                    "source": "SYNTHETIC - Open-Meteo fetch not yet complete"},
                   OUT / "weather_current.json")
        log(f"SYNTHETIC weather for {len(pts)} points")


if __name__ == "__main__":
    main()
