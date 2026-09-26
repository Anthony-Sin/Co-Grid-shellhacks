"""Build city_state.json — the statewide scene (Georgia + South Carolina).

Unlike the corridor scenes, a state-scale map does NOT render buildings
(hundreds of thousands of footprints would swamp the browser and add no
analytic value). The scene instead carries real, sourced geometry that
reads correctly at 500-km zoom:

  roads  -> interstate/trunk corridors + state & county boundaries
            (kind values map onto the existing road renderer:
            motorway/trunk draw as double-inked majors, county lines
            render as thin minor strokes, state line rides on top)
  water  -> named rivers as open polylines in `water` (kind="river")
  pois   -> named places (city/town/suburb) for label chips
  buildings/parks -> empty arrays, honestly (counts record 0)

Sources are read-only raw files (AGENTS §2):
  data/raw/osm/state_borders.json      (boundary=administrative rels —
    src.ingestion.osm_borders)
  data/raw/osm/state_roads_rivers.json (motorway/trunk + named rivers —
    src.ingestion.osm_roads_rivers)
  data/raw/osm/statewide_places.json   (place=city|town|suburb nodes —
    src.ingestion.osm_places)

Usage: ./venv/bin/python -m src.processing.build_state
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from .projection import SCENES, in_bbox, lonlat_to_local

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "osm"
OUT = ROOT / "data" / "processed"
SCENE = "state"

# Admin level -> road-style mapping. State line ranks as a major
# (double-inked, rides highest); county lines render as minor strokes.
_LEVEL_STYLE = {
    "4": ("trunk", 0),     # state boundary — most prominent
    "6": ("boundary", 7),  # county boundary — thin minor line
}
# ~110 m vertex decimation for long corridors at state zoom.
_SIMPLIFY_M = 110.0


def _load(name: str) -> dict:
    p = RAW / name
    if not p.exists():
        print(f"  ! missing {name} — skipped")
        return {"elements": []}
    return json.loads(p.read_text())


def _decimate(line: list[list[float]], tol: float = _SIMPLIFY_M) -> list[list[float]]:
    """Ramer–Douglas–Peucker-lite: drop interior points within `tol` of the
    running chord. Cheap O(n) pass — keeps shape at state zoom."""
    if len(line) <= 2:
        return line
    out = [line[0]]
    anchor = line[0]
    for pt in line[1:-1]:
        if math.hypot(pt[0] - anchor[0], pt[1] - anchor[1]) >= tol:
            out.append(pt)
            anchor = pt
    out.append(line[-1])
    return out


def _to_local(coords, center):
    return [list(lonlat_to_local(lon, lat, center)) for lon, lat in coords]


def build() -> dict:
    center = SCENES[SCENE]["center"]
    bbox = SCENES[SCENE]["bbox"]

    roads: list[dict] = []
    water: list[dict] = []
    pois: list[dict] = []
    min_x = min_y = math.inf
    max_x = max_y = -math.inf

    def track(pts):
        nonlocal min_x, min_y, max_x, max_y
        for x, y in pts:
            min_x, min_y = min(min_x, x), min(min_y, y)
            max_x, max_y = max(max_x, x), max(max_y, y)

    # ---- boundaries: relation outer ways -> boundary polylines -----------
    for rel in _load("state_borders.json").get("elements", []):
        if rel.get("type") != "relation":
            continue
        tags = rel.get("tags", {})
        kind, rank = _LEVEL_STYLE.get(str(tags.get("admin_level")), ("boundary", 7))
        name = tags.get("name")
        for m in rel.get("members", []):
            if m.get("role") != "outer" or not m.get("geometry"):
                continue
            coords = [(p["lon"], p["lat"]) for p in m["geometry"]]
            line = _to_local(coords, center)
            if len(line) < 2:
                continue
            line = _decimate(line, 60.0 if rank == 0 else 150.0)
            track(line)
            roads.append({
                "kind": kind,
                "rank": rank,
                "line": [[round(x, 1), round(y, 1)] for x, y in line],
                "name": name,
            })

    # ---- interstates/trunk corridors + named rivers ----------------------
    for el in _load("state_roads_rivers.json").get("elements", []):
        if el.get("type") != "way" or not el.get("geometry"):
            continue
        tags = el.get("tags", {})
        coords = [(p["lon"], p["lat"]) for p in el["geometry"]]
        line = _to_local(coords, center)
        if len(line) < 2:
            continue
        hw = tags.get("highway")
        if hw in ("motorway", "trunk"):
            line = _decimate(line, _SIMPLIFY_M)
            track(line)
            roads.append({
                "kind": hw,
                "rank": 0 if hw == "motorway" else 2,
                "line": [[round(x, 1), round(y, 1)] for x, y in line],
                "name": tags.get("name") or tags.get("ref"),
            })
        elif tags.get("waterway") == "river" and tags.get("name"):
            line = _decimate(line, 150.0)
            track(line)
            water.append({
                "kind": "river",
                "name": tags["name"],
                "line": [[round(x, 1), round(y, 1)] for x, y in line],
            })

    # ---- named places -> label chips -------------------------------------
    for el in _load("statewide_places.json").get("elements", []):
        tags = el.get("tags", {})
        name = tags.get("name")
        lon, lat = el.get("lon"), el.get("lat")
        if not name or lon is None or not in_bbox(lon, lat, bbox, pad=0.0):
            continue
        x, y = lonlat_to_local(lon, lat, center)
        poi = {
            "name": name,
            "kind": f"place_{tags.get('place', 'town')}",
            "x": round(x, 1),
            "y": round(y, 1),
        }
        # OSM population tag lets the label picker rank real city size
        try:
            pop = int(str(tags.get("population", "")).replace(",", ""))
            if pop > 0:
                poi["pop"] = pop
        except ValueError:
            pass
        pois.append(poi)

    roads.sort(key=lambda r: r["rank"])
    doc = {
        "scene": SCENE,
        "center": list(center),
        "source": "OpenStreetMap via Overpass API (boundaries, corridors, rivers, places)",
        "counts": {
            "buildings": 0,
            "roads": len(roads),
            "water": len(water),
            "parks": 0,
            "pois": len(pois),
        },
        "bounds_m": {
            "min_x": round(min_x if min_x != math.inf else 0, 1),
            "max_x": round(max_x if max_x != math.inf else 0, 1),
            "min_y": round(min_y if min_y != math.inf else 0, 1),
            "max_y": round(max_y if max_y != math.inf else 0, 1),
        },
        "buildings": [],
        "roads": roads,
        "water": water,
        "parks": [],
        "pois": pois,
    }
    return doc


def main() -> None:
    doc = build()
    out = OUT / f"city_{SCENE}.json"
    out.write_text(json.dumps(doc))
    print(f"state: {doc['counts']} -> {out.name} ({out.stat().st_size//1024} KB)")


if __name__ == "__main__":
    main()
