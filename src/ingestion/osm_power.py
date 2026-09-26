"""Download OSM power infrastructure (substations, switchgear, plants,
generators) for the whole study region — the gazetteer's OSM half and the
key to resolving named substations HIFLD anonymizes.

Output: data/raw/osm/power_infra.json (raw Overpass response).

Usage: ./venv/bin/python -m src.ingestion.osm_power
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "raw" / "osm"

# One bbox covering both scenes + the Jasper/Bluffton SC side.
BBOX = "31.9,-82.5,33.7,-80.6"  # s,w,n,e

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
HEADERS = {"User-Agent": "co-grid-hackathon/0.1 (OSM data, research)"}

QUERY = f"""
[out:json][timeout:90];
(
  node["power"~"substation|switch|plant|generator"]({BBOX});
  way["power"~"substation|switch|plant|generator"]({BBOX});
);
out center tags;
"""


def main() -> None:
    last = "no attempts"
    for attempt in range(4):
        url = ENDPOINTS[min(attempt, len(ENDPOINTS) - 1)]
        try:
            r = requests.post(url, data={"data": QUERY}, headers=HEADERS, timeout=180)
            if r.status_code == 200:
                data = r.json()
                if data.get("elements"):
                    (OUT / "power_infra.json").write_text(json.dumps(data))
                    named = sum(1 for e in data["elements"] if e.get("tags", {}).get("name"))
                    print(f"power_infra.json: {len(data['elements'])} elements ({named} named)")
                    return
                last = "empty elements"
            else:
                last = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            last = str(e)
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"power infra query failed: {last}")


if __name__ == "__main__":
    main()
