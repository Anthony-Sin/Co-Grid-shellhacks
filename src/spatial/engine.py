"""Core overlap engine.

Strategy (per AGENTS.md §6 — never brute-force O(N^2)):
1. Reproject all project geometries to EPSG:32617 (meters).
2. Build an STRtree; for every geometry, query candidates "dwithin" 40 km.
3. For candidate pairs only, compute exact closest-point distance and the
   nearest-point coordinates.
4. Classify tier, evaluate timeline overlap, emit OverlapRecords.

Cross-utility only: two projects from the SAME utility are not a
coordination opportunity (they already coordinate internally).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Optional

import geopandas as gpd
from shapely import STRtree
from shapely.geometry import LineString, Point
from shapely.ops import nearest_points

from .schema import OverlapRecord
from .tiers import MAX_DISTANCE_KM, classify_tier, tier_label, tier_threshold_km
from .timeline import windows_overlap

TARGET_CRS = "EPSG:32617"  # UTM 17N — covers Savannah & Augusta
_SOURCE_CRS = "EPSG:4326"
_KM = 1000.0


def load_projects(path: str | Path) -> gpd.GeoDataFrame:
    """Load projects.geojson into a projected GeoDataFrame."""
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs(_SOURCE_CRS)
    return gdf.to_crs(TARGET_CRS)


def _cross_utility_pairs(gdf: gpd.GeoDataFrame) -> list[tuple[int, int]]:
    """Candidate index pairs within 40 km, deduped, different utilities."""
    geoms = list(gdf.geometry)
    tree = STRtree(geoms)
    pairs: set[tuple[int, int]] = set()
    utils = list(gdf["utility"])
    for i, geom in enumerate(geoms):
        # dwithin is an exact-distance prefilter on the index — fast.
        hits = tree.query(geom, predicate="dwithin", distance=MAX_DISTANCE_KM * _KM)
        for j in hits:
            j = int(j)
            if j <= i or utils[i] == utils[j]:
                continue
            pairs.add((i, j))
    return sorted(pairs)


def find_overlaps(
    gdf: gpd.GeoDataFrame,
    zone: str = "savannah_river_corridor",
    ids: Optional[Iterable[str]] = None,
) -> list[OverlapRecord]:
    """Compute all ranked overlap records for a projected project GDF."""
    allowed = set(ids) if ids is not None else None
    geoms = list(gdf.geometry)
    out: list[OverlapRecord] = []
    n = 0
    for i, j in _cross_utility_pairs(gdf):
        a, b = gdf.iloc[i], gdf.iloc[j]
        if allowed is not None and (a.project_id not in allowed or b.project_id not in allowed):
            continue
        ga, gb = geoms[i], geoms[j]
        d_km = float(ga.distance(gb)) / _KM
        tier = classify_tier(d_km)
        if tier is None:
            continue
        pa_m, pb_m = nearest_points(ga, gb)
        # nearest_points are in projected meters — convert back to WGS84
        mid_m = Point((pa_m.x + pb_m.x) / 2, (pa_m.y + pb_m.y) / 2)
        pts = gpd.GeoSeries([pa_m, pb_m, mid_m], crs=TARGET_CRS).to_crs(_SOURCE_CRS)
        pt_a, pt_b, mid = pts.iloc[0], pts.iloc[1], pts.iloc[2]
        t_ok, shared = windows_overlap(a.start_year, a.end_year, b.start_year, b.end_year)
        # Coordination zone: capsule bridging the two closest points,
        # half-width = max(1.2 km, 60% of the gap) so it reads as an area.
        bridge_m = LineString([pa_m, pb_m]).buffer(
            max(1200.0, d_km * _KM * 0.6), cap_style=1, quad_segs=24
        )
        zone_geo = gpd.GeoSeries([bridge_m], crs=TARGET_CRS).to_crs(_SOURCE_CRS)
        n += 1
        out.append(
            OverlapRecord(
                overlap_id=f"OV-{n:04d}",
                project_a=a.project_id,
                project_b=b.project_id,
                utilities=sorted({a.utility, b.utility}),
                min_distance_km=round(d_km, 3),
                tier=tier,
                tier_label=tier_label(tier),
                tier_threshold_km=tier_threshold_km(tier),
                timeline_overlap=t_ok,
                shared_window=shared,
                closest_point_a=(round(pt_a.x, 6), round(pt_a.y, 6)),
                closest_point_b=(round(pt_b.x, 6), round(pt_b.y, 6)),
                midpoint=(round(mid.x, 6), round(mid.y, 6)),
                score=0.0,  # filled by ranker.score_overlaps
                zone=zone,
                zone_geometry=zone_geo.iloc[0].__geo_interface__,
            )
        )
    return out


def run(
    projects_path: str | Path,
    out_path: str | Path,
    zone: str = "savannah_river_corridor",
) -> list[OverlapRecord]:
    """Full pipeline: load -> detect -> score -> write overlaps.json."""
    from .ranker import attach_explanations, attach_costs, score_overlaps

    gdf = load_projects(projects_path)
    records = find_overlaps(gdf, zone=zone)
    records = score_overlaps(records)
    attach_explanations(records, gdf)
    attach_costs(records, gdf)
    payload = {
        "generated_at": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat(),
        "region": zone,
        "project_count": int(len(gdf)),
        "overlaps": [r.model_dump() for r in records],
    }
    Path(out_path).write_text(json.dumps(payload, indent=2))
    return records


if __name__ == "__main__":
    import sys

    src = sys.argv[1] if len(sys.argv) > 1 else "data/processed/projects.geojson"
    dst = sys.argv[2] if len(sys.argv) > 2 else "data/processed/overlaps.json"
    recs = run(src, dst)
    tiers = {}
    for r in recs:
        tiers[r.tier] = tiers.get(r.tier, 0) + 1
    print(f"{len(recs)} overlaps -> {dst} | tiers: {dict(sorted(tiers.items()))}")
