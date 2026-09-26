#!/usr/bin/env python3
"""Download administrative borders for the GA+SC state scene — rendered
as light ink borders on the statewide map view.

Pulls boundary=administrative relations with full member geometry
(``out geom;``):

* admin_level=4 state borders, matched by name: "Georgia",
  "South Carolina" (bbox-filtered so e.g. the country of Georgia cannot
  leak in), and
* admin_level=6 county borders intersecting the two-state envelope
  (includes county lines just across the FL/AL/TN/NC edges, which is
  desired at the margins of a state-level view).

Output: data/raw/osm/state_borders.json (raw Overpass response).

Overpass endpoint/retries live in src/ingestion/overpass.py
(env OVERPASS_URL, fallback overpass.kumi.systems on 429).

Run: ./venv/bin/python -m src.ingestion.osm_borders
     (direct: ./venv/bin/python src/ingestion/osm_borders.py)
"""
from __future__ import annotations

import json
from pathlib import Path

try:  # `python -m src.ingestion.osm_borders`
    from src.ingestion.overpass import post_overpass
except ModuleNotFoundError:  # `python src/ingestion/osm_borders.py`
    from overpass import post_overpass

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "raw" / "osm"

# Full Georgia + South Carolina envelope, Overpass order: (s, w, n, e).
STATE_BBOX = "30.30,-85.70,35.25,-78.00"

QUERY = f"""
[out:json][timeout:280];
(
  relation["boundary"="administrative"]["admin_level"="4"]
          ["name"~"^(Georgia|South Carolina)$"]({STATE_BBOX});
  relation["boundary"="administrative"]["admin_level"="6"]({STATE_BBOX});
);
out geom;
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = post_overpass(QUERY, "state_borders")
    elements = data.get("elements", [])
    if not elements:
        raise RuntimeError("state borders query returned 0 elements")
    (OUT / "state_borders.json").write_text(json.dumps(data))
    rels = [e for e in elements if e.get("type") == "relation"]
    by_level: dict[str, int] = {}
    for e in rels:
        lvl = e.get("tags", {}).get("admin_level", "?")
        by_level[lvl] = by_level.get(lvl, 0) + 1
    print(
        f"state_borders.json: {len(elements)} elements, "
        f"{len(rels)} relations by admin_level {by_level}"
    )


if __name__ == "__main__":
    main()
