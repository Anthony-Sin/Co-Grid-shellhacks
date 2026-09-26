"""Download named OSM points-of-interest for map label chips.

place=city/town/suburb/neighbourhood, named natural features, and major
amenity landmarks — enough real names to annotate the 3D map without ever
inventing labels. Output: data/raw/osm/<scene>_pois.json (raw).

Usage: ./venv/bin/python -m src.ingestion.osm_pois
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "raw" / "osm"

BBOXES = {
    "savannah": "31.95,-81.55,32.45,-80.75",
    "augusta": "33.25,-82.30,33.65,-81.60",
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


def main() -> None:
    for scene, bbox in BBOXES.items():
        data = fetch(scene, bbox)
        out = OUT / f"{scene}_pois.json"
        out.write_text(json.dumps(data))
        print(f"{scene}_pois.json: {len(data.get('elements', []))} elements")
        time.sleep(5)


if __name__ == "__main__":
    main()
