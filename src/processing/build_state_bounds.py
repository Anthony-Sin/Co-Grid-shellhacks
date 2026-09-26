#!/usr/bin/env python3
"""GA + SC state boundary polygons -> data/processed/state_bounds.geojson.

Source: U.S. Census Bureau 2024 cartographic boundary shapefile (500k),
public domain — data/raw/boundaries/cb_2024_us_state_500k.zip
(see data/raw/SOURCES.md). The raw zip stays immutable; extraction is a
pure read + filter + re-emit.

Output is WGS84 GeoJSON so the frontend can project with the same
lonLatToLocal() it uses for every other layer. A light 250 m
vertex decimation keeps the file tiny (the 500k set is already coarse).

Run: ./venv/bin/python -m src.processing.build_state_bounds
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "boundaries" / "cb_2024_us_state_500k.zip"
OUT = ROOT / "data" / "processed" / "state_bounds.geojson"
KEEP = {"GA": "Georgia", "SC": "South Carolina"}

# Drop ring vertices closer than this many degrees (~250 m) — the 500k
# boundary is already generalized; this just trims redundant near-dups.
_MIN_STEP_DEG = 0.0025


def _decimate(ring):
    if len(ring) <= 2:
        return [list(p) for p in ring]
    out = [list(ring[0])]
    ax, ay = ring[0]
    for x, y, *_ in ring[1:-1]:
        if math.hypot(x - ax, y - ay) >= _MIN_STEP_DEG:
            out.append([x, y])
            ax, ay = x, y
    out.append(list(ring[-1]))
    return out


def _geom_to_features(geom, name):
    polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
    feats = []
    for poly in polys:
        ring = _decimate(list(poly.exterior.coords))
        feats.append({
            "type": "Feature",
            "properties": {"state": name},
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })
    return feats


def main() -> None:
    if not RAW.exists():
        raise SystemExit(
            f"missing {RAW} — download the Census 500k state shapefile first"
        )
    # pyogrio can't read a bare .shp stream (needs .dbf/.shx siblings),
    # so mount the zip via GDAL's vsizip virtual filesystem instead.
    gdf = gpd.read_file(f"zip://{RAW}")
    gdf = gdf[gdf["STUSPS"].isin(KEEP)].to_crs("EPSG:4326")

    features = []
    for _, row in gdf.iterrows():
        features.extend(_geom_to_features(row.geometry, KEEP[row["STUSPS"]]))

    fc = {
        "type": "FeatureCollection",
        "source": "us-census-cb_2024_us_state_500k",
        "features": features,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fc, separators=(",", ":")))
    for f in features:
        n = len(f["geometry"]["coordinates"][0])
        print(f"  {f['properties']['state']}: {n} ring vertices")
    print(f"-> {OUT} ({OUT.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
