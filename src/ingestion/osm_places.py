#!/usr/bin/env python3
"""Download named OSM place nodes for the zoomed-out GA+SC state scene.

Named nodes only (``name`` tag required): place=city|town plus
place=suburb|borough — the label chips rendered on the statewide map
view. Output: data/raw/osm/statewide_places.json (raw Overpass response).

Overpass endpoint/retries live in src/ingestion/overpass.py
(env OVERPASS_URL, fallback overpass.kumi.systems on 429).

Run: ./venv/bin/python -m src.ingestion.osm_places
     (direct: ./venv/bin/python src/ingestion/osm_places.py)
"""
from __future__ import annotations

import json
from pathlib import Path

try:  # `python -m src.ingestion.osm_places`
    from src.ingestion.overpass import post_overpass
except ModuleNotFoundError:  # `python src/ingestion/osm_places.py`
    from overpass import post_overpass

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "raw" / "osm"

# Full Georgia + South Carolina envelope, Overpass order: (s, w, n, e).
STATE_BBOX = "30.30,-85.70,35.25,-78.00"

QUERY = f"""
[out:json][timeout:120];
node["place"~"^(city|town|suburb|borough)$"]["name"]({STATE_BBOX});
out;
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = post_overpass(QUERY, "statewide_places")
    elements = data.get("elements", [])
    if not elements:
        raise RuntimeError("statewide places query returned 0 elements")
    (OUT / "statewide_places.json").write_text(json.dumps(data))
    by_place: dict[str, int] = {}
    for e in elements:
        k = e.get("tags", {}).get("place", "?")
        by_place[k] = by_place.get(k, 0) + 1
    print(
        f"statewide_places.json: {len(elements)} named place nodes {by_place}"
    )


if __name__ == "__main__":
    main()
