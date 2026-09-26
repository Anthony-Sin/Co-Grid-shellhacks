#!/usr/bin/env python3
"""Download statewide road corridors + named rivers for the GA+SC state
scene — rendered as light ink strokes on the statewide map view.

Pulls way geometry (``out geom;``) for:

* ``highway`` in {motorway, trunk} — the interstate/principal-arterial
  corridors the scene draws at rank 0/2, and
* ``waterway=river`` ways carrying a ``name`` tag — the labeled rivers
  (Savannah, Chattahoochee, Santee, ...) drawn at the scene's heaviest
  decimation.

Output: data/raw/osm/state_roads_rivers.json (raw Overpass response —
~55k way elements for the two-state envelope).

Overpass endpoint/retries live in src/ingestion/overpass.py
(env OVERPASS_URL, fallback overpass.kumi.systems on 429).

Run: ./venv/bin/python -m src.ingestion.osm_roads_rivers
     (direct: ./venv/bin/python src/ingestion/osm_roads_rivers.py)
"""
from __future__ import annotations

import json
from pathlib import Path

try:  # `python -m src.ingestion.osm_roads_rivers`
    from src.ingestion.overpass import post_overpass
except ModuleNotFoundError:  # `python src/ingestion/osm_roads_rivers.py`
    from overpass import post_overpass

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "raw" / "osm"

# Full Georgia + South Carolina envelope, Overpass order: (s, w, n, e).
# Same envelope as osm_borders.STATE_BBOX so both scenes share coverage.
STATE_BBOX = "30.30,-85.70,35.25,-78.00"

QUERY = f"""
[out:json][timeout:280];
(
  way["highway"~"^(motorway|trunk)$"]({STATE_BBOX});
  way["waterway"="river"]["name"]({STATE_BBOX});
);
out geom;
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = post_overpass(QUERY, "state_roads_rivers")
    elements = data.get("elements", [])
    if not elements:
        raise RuntimeError("state roads/rivers query returned 0 elements")
    (OUT / "state_roads_rivers.json").write_text(json.dumps(data))
    by_kind: dict[str, int] = {}
    for e in elements:
        tags = e.get("tags", {})
        kind = tags.get("highway") or tags.get("waterway") or "?"
        by_kind[kind] = by_kind.get(kind, 0) + 1
    print(f"state_roads_rivers.json: {len(elements)} elements {by_kind}")


if __name__ == "__main__":
    main()
