"""Fire-weather multiplier W and moisture proxy M per weather point (PRD §9.2).

Weather is sampled on the coarse H3 res-3 grid (66 points over Spain) and
applied to every res-6 cell inside each, per PRD §7.2 - the fields are smooth
at that scale and it keeps request volume to 66 calls per source.

W and M are computed here rather than in the app because both depend on
per-point statistics of the ERA5 archive, which the browser never sees. The app
consumes W and M directly and computes COMBUSTION and PRIORITY from them.

z-scores are taken against the mean and standard deviation of the whole
historical archive, exactly as PRD §9.2 specifies. This was checked against the
alternative (a day-of-year climatology) before being adopted: on the literal
reading, peak-August W averages 1.22 and only ~5% of days pin to the 1.6 clamp,
so the term keeps its discriminating power and no deviation was warranted.

Outputs:
  data/out/weather_points.json   point ids and locations
  data/out/weather_current.json  this week / last week W and M + timestamp (F7)
  data/out/weather_history.json  weekly W and M, 2016-2025 (F14, F15)
"""
from __future__ import annotations

import datetime as dt
import json
import time
from pathlib import Path

import h3
import numpy as np
import requests

from .common import CONSTANTS, OUT, RAW, USER_AGENT, log, read_json, write_json

FORECAST_API = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_API = "https://archive-api.open-meteo.com/v1/archive"
DAILY = "temperature_2m_max,relative_humidity_2m_min,wind_speed_10m_max,precipitation_sum"
ARCHIVE_START, ARCHIVE_END = "2016-01-01", "2025-12-31"
PAST_DAYS = 35  # >= the 30-day moisture window, so M is defined for this week
CACHE = RAW / "openmeteo"


def _get(url: str, params: dict, cache_path: Path) -> dict:
    if cache_path.exists() and cache_path.stat().st_size > 0:
        return json.loads(cache_path.read_text())
    # A ten-year daily request is heavy in Open-Meteo's cost model and the free
    # tier answers 429 well before the documented per-minute ceiling. Back off
    # patiently: every point is cached, so a restart resumes where it stopped.
    delay = 10
    for attempt in range(1, 9):
        try:
            r = requests.get(url, params=params, timeout=120,
                             headers={"User-Agent": USER_AGENT})
        except requests.RequestException as exc:
            log(f"    network error ({type(exc).__name__}), retry in {delay}s")
            time.sleep(delay)
            delay = min(delay * 2, 120)
            continue
        if r.status_code == 200:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_bytes(r.content)
            return json.loads(r.content)
        if r.status_code in (429, 500, 502, 503, 504):
            log(f"    HTTP {r.status_code} (attempt {attempt}/8), retry in {delay}s")
            time.sleep(delay)
            delay = min(delay * 2, 120)
            continue
        raise SystemExit(f"Open-Meteo {r.status_code}: {r.text[:300]}")
    raise SystemExit(f"Open-Meteo gave up: {params}")


def days_since_rain(precip: np.ndarray, threshold: float) -> np.ndarray:
    """Running count of days since the last day exceeding the wet-day threshold."""
    out = np.zeros(len(precip))
    n = 0
    for i, p in enumerate(precip):
        n = 0 if (p is not None and p > threshold) else n + 1
        out[i] = n
    return out


def rolling_sum(x: np.ndarray, w: int) -> np.ndarray:
    """Trailing w-day sum; the first w-1 entries use what history exists."""
    c = np.concatenate([[0.0], np.nancumsum(np.nan_to_num(x))])
    idx = np.arange(len(x)) + 1
    lo = np.maximum(idx - w, 0)
    return c[idx] - c[lo]


class Model:
    """Holds the per-point archive statistics that z-scores are taken against."""

    def __init__(self, c):
        self.base = c.get("conditions.w_base")
        self.k_t = c.get("conditions.w_coef_tmax")
        self.k_rh = c.get("conditions.w_coef_rhmin")
        self.k_w = c.get("conditions.w_coef_wind")
        self.k_dr = c.get("conditions.w_coef_days_since_rain")
        self.lo = c.get("conditions.w_clamp_min")
        self.hi = c.get("conditions.w_clamp_max")
        self.rain_thr = c.get("conditions.rain_day_threshold_mm")
        self.mwin = c.get("conditions.moisture_window_days")
        self.msat = c.get("conditions.moisture_saturation_mm")

    def fit(self, tmax, rhmin, wind, precip):
        dsr = days_since_rain(precip, self.rain_thr)
        self.stats = {}
        for k, v in (("t", tmax), ("rh", -rhmin), ("w", wind), ("dr", dsr)):
            self.stats[k] = (float(np.nanmean(v)), float(np.nanstd(v)) or 1.0)
        return self

    def _z(self, k, v):
        m, s = self.stats[k]
        return (v - m) / s

    def W(self, tmax, rhmin, wind, precip):
        dsr = days_since_rain(precip, self.rain_thr)
        w = (self.base
             + self.k_t * self._z("t", tmax)
             + self.k_rh * self._z("rh", -rhmin)
             + self.k_w * self._z("w", wind)
             + self.k_dr * self._z("dr", dsr))
        return np.clip(w, self.lo, self.hi)

    def M(self, precip):
        return np.clip(rolling_sum(precip, self.mwin) / self.msat, 0.0, 1.0)


def _arr(daily, key):
    return np.array([np.nan if v is None else float(v) for v in daily[key]])


def main() -> None:
    c = CONSTANTS
    wres = c.get("grid.weather_h3_resolution")
    grid = read_json(OUT / "grid.json")["cells"]
    points = sorted({h3.cell_to_parent(x, wres) for x in grid})
    log(f"{len(points)} weather points at res {wres}")

    pts_out = {"resolution": wres, "points": points,
               "lat": [], "lon": [],
               "archive": {"start": ARCHIVE_START, "end": ARCHIVE_END,
                           "source": "Open-Meteo archive API (ERA5)"}}
    current = {"points": points, "this_week": {"W": [], "M": []},
               "last_week": {"W": [], "M": []}}
    history: dict[str, dict] = {}

    for i, p in enumerate(points, 1):
        lat, lon = h3.cell_to_latlng(p)
        pts_out["lat"].append(round(lat, 4))
        pts_out["lon"].append(round(lon, 4))

        # --- archive: defines the z-score baseline and the historic weeks ---
        a = _get(ARCHIVE_API, {"latitude": round(lat, 4), "longitude": round(lon, 4),
                               "start_date": ARCHIVE_START, "end_date": ARCHIVE_END,
                               "daily": DAILY, "timezone": "UTC"},
                 CACHE / "archive" / f"{p}.json")["daily"]
        at = _arr(a, "temperature_2m_max"); arh = _arr(a, "relative_humidity_2m_min")
        aw = _arr(a, "wind_speed_10m_max"); ap = _arr(a, "precipitation_sum")
        model = Model(c).fit(at, arh, aw, ap)

        aW, aM = model.W(at, arh, aw, ap), model.M(ap)
        adates = [dt.date.fromisoformat(s) for s in a["time"]]
        weeks: dict[str, list] = {}
        for d, wv, mv in zip(adates, aW, aM):
            iso = d.isocalendar()
            weeks.setdefault(f"{iso.year}-W{iso.week:02d}", []).append((wv, mv))
        history[p] = {k: [round(float(np.mean([x[0] for x in v])), 3),
                          round(float(np.mean([x[1] for x in v])), 3)]
                      for k, v in sorted(weeks.items())}

        # --- forecast: this week and last week, on the same baseline ---
        f = _get(FORECAST_API, {"latitude": round(lat, 4), "longitude": round(lon, 4),
                                "daily": DAILY, "past_days": PAST_DAYS,
                                "forecast_days": 7, "timezone": "UTC"},
                 CACHE / "forecast" / f"{p}.json")["daily"]
        ft = _arr(f, "temperature_2m_max"); frh = _arr(f, "relative_humidity_2m_min")
        fw = _arr(f, "wind_speed_10m_max"); fp = _arr(f, "precipitation_sum")
        fW, fM = model.W(ft, frh, fw, fp), model.M(fp)

        today = dt.date.today()
        fdates = [dt.date.fromisoformat(s) for s in f["time"]]
        tw = [j for j, d in enumerate(fdates) if 0 <= (d - today).days < 7]
        lw = [j for j, d in enumerate(fdates) if -7 <= (d - today).days < 0]
        for key, idx in (("this_week", tw), ("last_week", lw)):
            current[key]["W"].append(round(float(np.mean(fW[idx])), 3))
            current[key]["M"].append(round(float(np.mean(fM[idx])), 3))

        if i % 10 == 0 or i == len(points):
            log(f"  {i}/{len(points)} points")

    current["generated_utc"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    current["source"] = "Open-Meteo forecast API"

    allW = np.array(current["this_week"]["W"])
    log(f"this week W: min {allW.min():.2f} mean {allW.mean():.2f} max {allW.max():.2f}")
    log(f"history: {len(history)} points x "
        f"{len(next(iter(history.values())))} weeks")

    write_json(pts_out, OUT / "weather_points.json")
    write_json(current, OUT / "weather_current.json")
    write_json(history, OUT / "weather_history.json")


if __name__ == "__main__":
    main()
