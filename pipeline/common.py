"""Shared plumbing for the FUSION data pipeline.

C6: every script here is re-runnable and caches its downloads under data/raw/,
which is gitignored. Prepared outputs go to data/out/ and are committed.
"""
from __future__ import annotations

import gzip
import json
import shutil
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
# Prepared outputs are the pipeline's product and are committed (C6). They live
# in their own top-level folder rather than inside the app, and are staged into
# app/public/data/ by app/scripts/stage-data.mjs on every dev/build run - the
# same pattern used for the MapLibre worker.
OUT = ROOT / "data" / "prepared"
# Intermediates that the app never loads (derivable, so not committed).
INTERIM = ROOT / "data" / "interim"
CONSTANTS_PATH = ROOT / "constants.json"

# Overpass and several other public endpoints reject requests without a
# descriptive agent (overpass-api.de answers 406 to a bare curl).
USER_AGENT = "FUSION-wildfire-prioritisation/0.1 (HackBarna 2026; contact: team via GitHub repo)"

RAW.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
INTERIM.mkdir(parents=True, exist_ok=True)


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


class Constants:
    """Reads constants.json (F19) and unwraps the {value, status, source} envelope.

    The app reads the very same file, so the pipeline and the UI can never drift.
    """

    def __init__(self, path: Path = CONSTANTS_PATH):
        self.path = path
        self.raw = json.loads(path.read_text())

    def get(self, dotted: str):
        """c.get('fuel.w_tree') -> 1.0 ; unwraps .value automatically."""
        node = self.raw
        for part in dotted.split("."):
            node = node[part]
        if isinstance(node, dict) and "value" in node:
            return node["value"]
        return node

    def node(self, dotted: str) -> dict:
        node = self.raw
        for part in dotted.split("."):
            node = node[part]
        return node


CONSTANTS = Constants()


def download(url: str, dest: Path, *, decompress_gz: bool = False, timeout: int = 300) -> Path:
    """Cache-aware download. Returns dest; skips the request if dest already exists."""
    if dest.exists() and dest.stat().st_size > 0:
        log(f"cached  {dest.name} ({dest.stat().st_size/1e6:.1f} MB)")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    log(f"GET     {url}")
    with requests.get(url, stream=True, timeout=timeout,
                      headers={"User-Agent": USER_AGENT}) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done = 0
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
                done += len(chunk)
                if total:
                    pct = 100 * done / total
                    print(f"\r        {dest.name}: {pct:5.1f}% ({done/1e6:.0f}/{total/1e6:.0f} MB)",
                          end="", file=sys.stderr, flush=True)
        if total:
            print(file=sys.stderr)
    if decompress_gz:
        log(f"gunzip  {dest.name}")
        with gzip.open(tmp, "rb") as fi, open(dest, "wb") as fo:
            shutil.copyfileobj(fi, fo)
        tmp.unlink()
    else:
        tmp.rename(dest)
    log(f"saved   {dest.name} ({dest.stat().st_size/1e6:.1f} MB)")
    return dest


def write_json(obj, dest: Path, *, compact: bool = True) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, separators=(",", ":") if compact else None,
                      indent=None if compact else 2, ensure_ascii=False)
    dest.write_text(text)
    log(f"wrote   {dest.relative_to(ROOT)} ({len(text)/1e6:.2f} MB)")
    return dest


def read_json(path: Path):
    return json.loads(Path(path).read_text())
