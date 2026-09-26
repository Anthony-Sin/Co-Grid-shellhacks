"""Convert raw Overpass JSON (data/raw/osm/) into city_<scene>.json —
compact scene-local geometry the three.js frontend renders directly.

Only *processes* real OSM data; raw files are never modified (AGENTS §2).

Usage: ./venv/bin/python -m src.processing.build_city savannah
       ./venv/bin/python -m src.processing.build_city augusta
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any, Iterable, Optional

from .projection import SCENES, in_bbox, lonlat_to_local

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "osm"
OUT = ROOT / "data" / "processed"

# Roads we keep, ordered by visual importance.
ROAD_RANK = {
    "motorway": 0, "motorway_link": 1, "trunk": 0, "trunk_link": 1,
    "primary": 2, "primary_link": 3, "secondary": 4, "secondary_link": 5,
    "tertiary": 6, "residential": 7, "unclassified": 7, "service": 8,
    "rail": 9,
}
# Building tag -> coarse render kind (drives facade palette on the frontend).
_BUILDING_KINDS = {
    "church": "civic", "cathedral": "civic", "chapel": "civic", "civic": "civic",
    "government": "civic", "hospital": "civic", "school": "civic",
    "university": "civic", "college": "civic", "public": "civic",
    "commercial": "commercial", "office": "commercial", "retail": "commercial",
    "hotel": "commercial", "supermarket": "commercial", "mall": "commercial",
    "industrial": "industrial", "warehouse": "industrial", "factory": "industrial",
    "manufacture": "industrial",
    "house": "residential", "residential": "residential", "apartments": "residential",
    "detached": "residential", "terrace": "residential", "dormitory": "residential",
    "garage": "residential", "shed": "residential",
}


def _load(scene: str, group: str) -> dict:
    path = RAW / f"{scene}_{group}.json"
    if not path.exists():
        return {"elements": []}
    return json.loads(path.read_text())


def _way_coords(el: dict) -> Optional[list[tuple[float, float]]]:
    """Return [(lon,lat)] from a way's inline geometry, or None."""
    geom = el.get("geometry")
    if not geom or len(geom) < 2:
        return None
    return [(p["lon"], p["lat"]) for p in geom]


def _closed(coords: list[tuple[float, float]]) -> bool:
    return len(coords) >= 4 and coords[0] == coords[-1]


def _ring_to_local(
    coords: Iterable[tuple[float, float]], center: tuple[float, float]
) -> list[list[float]]:
    return [list(lonlat_to_local(lon, lat, center)) for lon, lat in coords]


def _height(tags: dict, el_id: int) -> float:
    """OSM height tag > levels*3.2 > deterministic 8-14 m fallback."""
    try:
        if tags.get("height"):
            return max(3.0, min(300.0, float(str(tags["height"]).split()[0].replace("m", ""))))
    except ValueError:
        pass
    try:
        if tags.get("building:levels"):
            return max(3.0, float(tags["building:levels"]) * 3.2)
    except ValueError:
        pass
    return 8.0 + (el_id % 7)  # seeded variety, deterministic


def _kind(tags: dict) -> str:
    b = str(tags.get("building", "yes")).lower()
    if b in _BUILDING_KINDS:
        return _BUILDING_KINDS[b]
    amenity = str(tags.get("amenity", "")).lower()
    if amenity in ("place_of_worship", "townhall", "courthouse", "hospital", "school"):
        return "civic"
    return "default"


CORE_RADIUS_M = 13_000   # full-detail urban core radius
_MAX_ROADS = 45_000      # rank-sorted cap per scene
_MIN_FOOTPRINT_M2 = 45.0  # sheds/carports below this are dropped (still real
                          # data — decluttered for render performance)


def _dist2(x: float, y: float) -> float:
    return x * x + y * y


def _ring_area_m2(ring: list[list[float]]) -> float:
    a = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def build(scene: str) -> dict:
    center = SCENES[scene]["center"]
    bbox = SCENES[scene]["bbox"]

    buildings, roads, water, parks = [], [], [], []
    min_x = min_y = math.inf
    max_x = max_y = -math.inf
    r2 = CORE_RADIUS_M * CORE_RADIUS_M

    def track(ring: list[list[float]]) -> None:
        nonlocal min_x, min_y, max_x, max_y
        for x, y in ring:
            min_x, min_y = min(min_x, x), min(min_y, y)
            max_x, max_y = max(max_x, x), max(max_y, y)

    for el in _load(scene, "buildings").get("elements", []):
        if el.get("type") != "way":
            continue
        coords = _way_coords(el)
        if not coords or not _closed(coords):
            continue
        ring = _ring_to_local(coords[:-1], center)  # drop duplicated close pt
        if len(ring) < 3:
            continue
        # Density shaping: everything inside the core; outside it only
        # tall / named / civic structures (rural fringe thins out).
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        tags = el.get("tags", {})
        h = _height(tags, int(el["id"]) % 7)
        kind = _kind(tags)
        if _dist2(cx, cy) > r2 and not (
            h >= 14 or tags.get("name") or kind in ("civic", "industrial")
        ):
            continue
        # Micro-outbuildings clutter the toon look & blow up vertex count;
        # skip tiny unnamed sheds/garages everywhere.
        if (
            _ring_area_m2(ring) < _MIN_FOOTPRINT_M2
            and not tags.get("name")
            and kind in ("residential", "default")
        ):
            continue
        track(ring)
        buildings.append(
            {
                "id": el["id"],
                "footprint": [[round(x, 1), round(y, 1)] for x, y in ring],
                "height": h,
                "kind": kind,
                "name": tags.get("name"),
            }
        )

    for el in _load(scene, "roads").get("elements", []):
        if el.get("type") != "way":
            continue
        coords = _way_coords(el)
        if not coords:
            continue
        tags = el.get("tags", {})
        hw = "rail" if tags.get("railway") == "rail" else tags.get("highway", "residential")
        line = _ring_to_local(coords, center)
        # Outside the core, drop minor/service roads.
        mx = sum(p[0] for p in line) / len(line)
        my = sum(p[1] for p in line) / len(line)
        if _dist2(mx, my) > r2 and ROAD_RANK.get(hw, 7) >= 7:
            continue
        track(line)
        roads.append(
            {
                "kind": hw,
                "rank": ROAD_RANK.get(hw, 7),
                "line": [[round(x, 1), round(y, 1)] for x, y in line],
                "name": tags.get("name"),
            }
        )

    def polygons(group: str) -> list[dict]:
        out = []
        for el in _load(scene, group).get("elements", []):
            if el.get("type") != "way":
                continue  # multipolygon relations handled by outer-ways only
            coords = _way_coords(el)
            if not coords or not _closed(coords):
                continue
            ring = _ring_to_local(coords[:-1], center)
            if len(ring) < 3:
                continue
            track(ring)
            tags = el.get("tags", {})
            kind = (
                tags.get("water")
                or tags.get("waterway")
                or tags.get("natural")
                or tags.get("landuse")
                or tags.get("leisure")
                or "other"
            )
            out.append(
                {
                    "kind": str(kind),
                    "polygon": [[round(x, 1), round(y, 1)] for x, y in ring],
                }
            )
        return out

    water = polygons("water")
    parks = polygons("green")
    roads.sort(key=lambda r: r["rank"])
    roads = roads[:_MAX_ROADS]

    # Named POIs -> floating label chips (real OSM names only).
    pois = []
    for el in _load(scene, "pois").get("elements", []):
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        if el.get("type") == "node":
            lon, lat = el.get("lon"), el.get("lat")
        else:
            c = el.get("center") or {}
            lon, lat = c.get("lon"), c.get("lat")
        if lon is None or lat is None or not in_bbox(lon, lat, bbox, pad=0.02):
            continue
        x, y = lonlat_to_local(lon, lat, center)
        kind = next(
            (k for k in ("place", "natural", "tourism", "historic", "amenity", "leisure", "waterway") if tags.get(k)),
            "place",
        )
        pois.append({"name": name, "kind": kind, "x": round(x, 1), "y": round(y, 1)})

    doc = {
        "scene": scene,
        "center": list(center),
        "source": "OpenStreetMap via Overpass API",
        "counts": {
            "buildings": len(buildings),
            "roads": len(roads),
            "water": len(water),
            "parks": len(parks),
            "pois": len(pois),
        },
        "bounds_m": {
            "min_x": round(min_x if min_x != math.inf else 0, 1),
            "max_x": round(max_x if max_x != math.inf else 0, 1),
            "min_y": round(min_y if min_y != math.inf else 0, 1),
            "max_y": round(max_y if max_y != math.inf else 0, 1),
        },
        "buildings": buildings,
        "roads": roads,
        "water": water,
        "parks": parks,
        "pois": pois,
    }
    return doc


def main() -> None:
    scenes = sys.argv[1:] or list(SCENES)
    for scene in scenes:
        doc = build(scene)
        out = OUT / f"city_{scene}.json"
        out.write_text(json.dumps(doc))
        print(f"{scene}: {doc['counts']} -> {out.name} ({out.stat().st_size//1024} KB)")


if __name__ == "__main__":
    main()
