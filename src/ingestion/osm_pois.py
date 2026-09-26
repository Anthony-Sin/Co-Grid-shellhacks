"""Download named OSM points-of-interest for map label chips.

place=city/town/suburb/neighbourhood, named natural features, and major
amenity landmarks — enough real names to annotate the 3D map without ever
inventing labels. Output: data/raw/osm/<scene>_pois.json (raw).

Usage: ./venv/bin/python -m src.ingestion.osm_pois [scene ...]
       (no args = every scene in BBOXES; args filter to those scenes)
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "raw" / "osm"

# (south, west, north, east) — same bboxes as osm_download.BBOXES.
BBOXES = {
    "savannah": "31.95,-81.55,32.45,-80.75",
    "augusta": "33.25,-82.30,33.65,-81.60",
    "atlanta": "33.67,-84.50,33.85,-84.28",
    "columbia": "33.93,-81.13,34.07,-80.95",
    "charleston": "32.70,-80.03,32.90,-79.85",
    "greenville_sc": "34.77,-82.47,34.92,-82.32",
    "columbus_ga": "32.38,-85.07,32.54,-84.91",
    "athens": "33.895,-83.45,34.015,-83.31",
    "macon": "32.75,-83.72,32.93,-83.55",
}
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
HEADERS = {"User-Agent": "co-grid-hackathon/0.1 (OSM data, research)"}

QUERY = """
[out:json][timeout:60];
(
  node["place"~"city|town|suburb|neighbourhood|quarter|village|hamlet"]({bbox});
  node["natural"~"peak|bay|cape|water|wood"]["name"]({bbox});
  node["tourism"~"attraction|museum"]["name"]({bbox});
  node["historic"]["name"]({bbox});
  node["amenity"~"university|hospital|theatre"]["name"]({bbox});
  way["leisure"="park"]["name"]({bbox});
  relation["waterway"="river"]["name"]({bbox});
);
out center tags;
"""


def fetch(scene: str, bbox: str) -> dict:
    q = QUERY.replace("{bbox}", bbox)
    last = None
    for attempt in range(4):
        url = ENDPOINTS[min(attempt, len(ENDPOINTS) - 1)]
        try:
            r = requests.post(url, data={"data": q}, headers=HEADERS, timeout=120)
            if r.status_code == 200:
                data = r.json()
                if data.get("elements"):
                    return data
            last = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            last = str(e)
        time.sleep(8 * (attempt + 1))
    raise RuntimeError(f"POI query failed for {scene}: {last}")


def main() -> int:
    scenes = sys.argv[1:] or list(BBOXES)
    unknown = [s for s in scenes if s not in BBOXES]
    if unknown:
        print(f"unknown scene(s): {unknown} — choices: {sorted(BBOXES)}")
        return 2
    rc = 0
    for scene, bbox in BBOXES.items():
        if scene not in scenes:
            continue
        try:
            data = fetch(scene, bbox)
        except Exception as exc:  # noqa: BLE001
            print(f"{scene}_pois.json: FAILED: {exc}")
            rc = 1
            continue
        out = OUT / f"{scene}_pois.json"
        out.write_text(json.dumps(data))
        print(f"{scene}_pois.json: {len(data.get('elements', []))} elements")
        time.sleep(5)
    return rc


if __name__ == "__main__":
    sys.exit(main())
