"""Staging-cluster analysis — which overlaps share one staging yard.

The challenge's 40 km rule is about crew-drive distance from a single
staging site. Two passes over real overlap midpoints:

1. connectivity — union-find on <=40 km midpoint edges groups sites into
   "corridors" (chains can span hundreds of km; reported as context).
2. yard cover — each corridor is partitioned by greedy set-cover into
   disk clusters: the member midpoint covering the most still-uncovered
   members becomes the yard site. Every emitted cluster is genuinely
   yard-servable: all members sit within ``radius_km`` of the yard.

``cluster_count`` is therefore a real "yards needed" estimate — not a
connectivity count. Pure functions over loaded overlaps.json; numpy only
for the O(k^2) haversine matrix. All inputs are real engine outputs.
"""
from __future__ import annotations

import math
from typing import Optional

import numpy as np

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


def _neighbor_sets(mpts: np.ndarray, radius_km: float) -> list[set]:
    """midpoint indexes within radius of each midpoint (vectorized)."""
    rad = np.radians(mpts)
    lon, lat = rad[:, 0], rad[:, 1]
    dlat = lat[:, None] - lat[None, :]
    dlon = lon[:, None] - lon[None, :]
    h = (np.sin(dlat / 2) ** 2
         + np.cos(lat[:, None]) * np.cos(lat[None, :])
         * np.sin(dlon / 2) ** 2)
    dist = 6371.0 * 2 * np.arcsin(np.sqrt(np.clip(h, 0, 1)))
    return [set(np.flatnonzero(row <= radius_km).tolist()) for row in dist]


def _components(neighbors: list[set]) -> list[list[int]]:
    """Union-find over the neighbor graph -> corridor member index lists."""
    parent = list(range(len(neighbors)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, ns in enumerate(neighbors):
        for j in ns:
            ra, rb = find(i), find(j)
            if ra != rb:
                parent[ra] = rb
    groups: dict[int, list[int]] = {}
    for i in range(len(neighbors)):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def _yard_cover(members: list[int], neighbors: list[set],
                pts: list) -> list[set]:
    """Greedy disk cover: repeatedly place a yard on the member midpoint
    reaching the most uncovered members -> real yard-servable clusters."""
    uncovered = set(members)
    disks: list[set] = []
    while uncovered:
        yard = max(uncovered, key=lambda i: (
            len(neighbors[i] & uncovered), -pts[i][0]))
        cover = neighbors[yard] & uncovered
        disks.append(cover)
        uncovered -= cover
    return disks


def build_clusters(overlaps, radius_km: float = CLUSTER_RADIUS_KM) -> dict:
    """Partition overlaps into yard-servable clusters. Returns ranked
    cluster list (each within ``radius_km`` of its yard site), plus
    corridor connectivity context for the mega-chains that don't fit
    one yard."""
    rows = overlaps.get("overlaps", []) if isinstance(overlaps, dict) \
        else list(overlaps or [])
    pts = []
    for i, r in enumerate(rows):
        mp = _midpoint(r)
        if mp is not None:
            pts.append((i, mp, r))
    if not pts:
        return {
            "metric": "staging_clusters", "radius_km": radius_km,
            "cluster_count": 0, "corridor_count": 0,
            "overlaps_clustered": 0, "overlaps_total": len(rows),
            "clusters": [], "corridors": [],
        }

    mpts = np.array([mp for _, mp, _ in pts], dtype=float)
    neighbors = _neighbor_sets(mpts, radius_km)
    corridors = _components(neighbors)
    corridors.sort(key=len, reverse=True)

    clusters = []
    corridor_rows = []
    for ci, members in enumerate(corridors, 1):
        corridor_id = f"CC-{ci:03d}"
        lons = [pts[m][1][0] for m in members]
        lats = [pts[m][1][1] for m in members]
        ccx, ccy = sum(lons) / len(lons), sum(lats) / len(lats)
        cspan = max((_hav_km([ccx, ccy], pts[m][1]) for m in members),
                    default=0.0)
        disks = _yard_cover(members, neighbors, [p[1] for p in pts])
        corridor_rows.append({
            "corridor_id": corridor_id,
            "size": len(members),
            "centroid": [round(ccx, 5), round(ccy, 5)],
            "span_km": round(cspan, 1),
            "yards_needed": len(disks),
        })
        for disk in disks:
            members_d = sorted(disk)
            recs = [pts[m][2] for m in members_d]
            yard_idx = max(
                members_d, key=lambda m: len(neighbors[m] & disk))
            yard_mp = pts[yard_idx][1]
            yard_rec = pts[yard_idx][2]
            cx = sum(pts[m][1][0] for m in members_d) / len(members_d)
            cy = sum(pts[m][1][1] for m in members_d) / len(members_d)
            utils = sorted({u for r in recs for u in (r.get("utilities") or [])})
            tiers = sorted({r.get("tier") for r in recs if r.get("tier")})
            # 0.0 km (touching) is a real distance — None-check, not `or`
            best = min(recs, key=lambda r: (
                r["min_distance_km"]
                if r.get("min_distance_km") is not None else 9e9))
            max_d = max((_hav_km(yard_mp, pts[m][1]) for m in members_d),
                        default=0.0)
            clusters.append({
                "cluster_id": f"CL-{len(clusters) + 1:03d}",
                "corridor_id": corridor_id,
                "size": len(members_d),
                "centroid": [round(cx, 5), round(cy, 5)],
                "yard_site": {
                    "lon": round(yard_mp[0], 5),
                    "lat": round(yard_mp[1], 5),
                    "at_overlap_id": yard_rec.get("overlap_id"),
                },
                "max_site_distance_km": round(max_d, 1),
                "utilities_involved": utils,
                "tiers_present": tiers,
                "best_overlap": best.get("overlap_id"),
                "best_distance_km": best.get("min_distance_km"),
                "overlap_ids": [r.get("overlap_id") for r in recs],
                "note": (
                    f"one staging yard at the yard site serves every site "
                    f"in this cluster — all within {radius_km:g} km of it"),
            })
    clusters.sort(key=lambda c: (-c["size"], c["best_distance_km"]))
    return {
        "metric": "staging_clusters",
        "radius_km": radius_km,
        "cluster_count": len(clusters),
        "corridor_count": len(corridor_rows),
        "overlaps_clustered": sum(c["size"] for c in clusters),
        "overlaps_total": len(rows),
        "clusters": clusters,
        "corridors": corridor_rows,
        "note": (
            "clusters are yard-servable disks: every member sits within "
            "radius_km of the cluster's yard site, so one staging yard "
            "genuinely reaches all of them. cluster_count is the yards-"
            "needed estimate. Corridors are the wider connectivity chains "
            "(context — a single yard cannot serve a whole corridor)."
        ),
    }
