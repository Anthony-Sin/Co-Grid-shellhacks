"""Staging-cluster analysis — which overlaps share one staging yard.

The challenge's 40 km rule is about crew-drive distance from a single
staging site. This groups overlap records whose midpoints fall within
40 km of each other into clusters: one yard could serve every
coordination site in the cluster, compounding the logistics win.

Pure functions over loaded overlaps.json — union-find on great-circle
edges, no sklearn. All inputs are real engine outputs; nothing inferred.
"""
from __future__ import annotations

import math
from typing import Optional

CLUSTER_RADIUS_KM = 40.0


def _hav_km(a: list, b: list) -> float:
    """Great-circle km between [lon,lat] pairs."""
    lon1, lat1, lon2, lat2 = (
        math.radians(a[0]), math.radians(a[1]),
        math.radians(b[0]), math.radians(b[1]),
    )
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = (math.sin(dlat / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2)
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def _midpoint(rec: dict) -> Optional[list]:
    mp = rec.get("midpoint")
    if isinstance(mp, (list, tuple)) and len(mp) >= 2 \
            and all(isinstance(v, (int, float)) for v in mp[:2]):
        return [mp[0], mp[1]]
    return None


def build_clusters(overlaps, radius_km: float = CLUSTER_RADIUS_KM) -> dict:
    """Cluster overlaps by midpoint proximity. Returns ranked cluster list
    with member overlap ids, representative point, tier mix, and the
    utilities involved — enough for the UI to draw 'one yard, N sites'."""
    rows = overlaps.get("overlaps", []) if isinstance(overlaps, dict) \
        else list(overlaps or [])
    pts = []
    for i, r in enumerate(rows):
        mp = _midpoint(r)
        if mp is not None:
            pts.append((i, mp, r))

    parent = list(range(len(pts)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    # O(k²) over records that have midpoints — k is a few hundred, fine.
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            if _hav_km(pts[i][1], pts[j][1]) <= radius_km:
                union(i, j)

    groups: dict[int, list[tuple[int, list, dict]]] = {}
    for k, (i, mp, r) in enumerate(pts):
        groups.setdefault(find(k), []).append((i, mp, r))

    clusters = []
    for members in groups.values():
        cx = sum(m[1][0] for m in members) / len(members)
        cy = sum(m[1][1] for m in members) / len(members)
        utils = sorted({u for m in members for u in (m[2].get("utilities") or [])})
        tiers = sorted({m[2].get("tier") for m in members if m[2].get("tier")})
        best = min(members, key=lambda m: m[2].get("min_distance_km") or 9e9)
        span_km = max(
            (_hav_km([cx, cy], m[1]) for m in members), default=0.0
        )
        clusters.append({
            "cluster_id": f"CL-{len(clusters) + 1:03d}",
            "size": len(members),
            "centroid": [round(cx, 5), round(cy, 5)],
            "span_km": round(span_km, 1),
            "utilities_involved": utils,
            "tiers_present": tiers,
            "best_overlap": best[2].get("overlap_id"),
            "best_distance_km": best[2].get("min_distance_km"),
            "overlap_ids": [m[2].get("overlap_id") for m in members],
            "note": ("one staging yard near the centroid could serve every "
                     "overlap in this cluster"),
        })
    clusters.sort(key=lambda c: (-c["size"], c["best_distance_km"]))
    return {
        "metric": "staging_clusters",
        "radius_km": radius_km,
        "cluster_count": len(clusters),
        "overlaps_clustered": sum(c["size"] for c in clusters),
        "overlaps_total": len(rows),
        "clusters": clusters,
    }
