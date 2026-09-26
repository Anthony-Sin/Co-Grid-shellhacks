#!/usr/bin/env python3
"""Download OSM power infrastructure (substations, switchgear, plants,
generators) for the full Georgia + South Carolina state scene — the
gazetteer's OSM half and the key to resolving named substations HIFLD
anonymizes.

Output: data/raw/osm/power_infra.json (raw Overpass response; a strict
superset of the original two-city-corridor pull).

Strategy: try one statewide query first; if it fails/times out, split the
envelope into a 2x2 grid of sub-bboxes and merge the tile results, deduped
by (element type, id). Overpass endpoint/retries live in
src/ingestion/overpass.py (env OVERPASS_URL).

Run: ./venv/bin/python -m src.ingestion.osm_power
     (direct: ./venv/bin/python src/ingestion/osm_power.py)
"""
from __future__ import annotations

import json
import time
from pathlib import Path

try:  # `python -m src.ingestion.osm_power`
    from src.ingestion.overpass import (
        merge_elements,
        post_overpass,
        split_bbox,
    )
except ModuleNotFoundError:  # `python src/ingestion/osm_power.py`
    from overpass import merge_elements, post_overpass, split_bbox

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "raw" / "osm"

# Full Georgia + South Carolina envelope, Overpass order: (s, w, n, e).
STATE_BBOX = (30.30, -85.70, 35.25, -78.00)
SLEEP_BETWEEN_TILES_S = 2

QUERY = """
[out:json][timeout:280];
(
  node["power"~"substation|switch|plant|generator"]({bbox});
  way["power"~"substation|switch|plant|generator"]({bbox});
);
out center tags;
"""


def _bbox_str(bbox: tuple) -> str:
    return ",".join(str(v) for v in bbox)


def fetch_power() -> dict:
    """One statewide query; fall back to a 2x2 tile grid + merge."""
    try:
        return post_overpass(
            QUERY.format(bbox=_bbox_str(STATE_BBOX)), "power_infra"
        )
    except RuntimeError as exc:
        print(f"  statewide query failed ({exc}); splitting into tiles")
    parts = []
    for i, tile in enumerate(split_bbox(STATE_BBOX, 2)):
        print(f"  tile {i + 1}/4 {tile}")
        parts.append(
            post_overpass(
                QUERY.format(bbox=_bbox_str(tile)),
                f"power_infra tile {i + 1}",
            )
        )
        time.sleep(SLEEP_BETWEEN_TILES_S)
    return merge_elements(parts)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = fetch_power()
    elements = data.get("elements", [])
    if not elements:
        raise RuntimeError("power infra query returned 0 elements")
    (OUT / "power_infra.json").write_text(json.dumps(data))
    named = sum(
        1 for e in elements if e.get("tags", {}).get("name")
    )
    print(
        f"power_infra.json: {len(elements)} elements ({named} named)"
    )


if __name__ == "__main__":
    main()
