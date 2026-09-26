"""Overlap-neighborhood proximity — other coordination records whose
midpoints sit within `radius_km` of an anchor record's midpoint.

Shared by `/api/analysis/nearby/{id}` and the agent's
`overlap_neighbors` tool — the "what else would a staging yard at this
site also reach?" question. Haversine on midpoints is honest here:
records are already engine-qualified (<40 km closest-point); this is
yard-siting context, not a second detection pass.
"""
from __future__ import annotations

import math

EARTH_KM = 6371.0


def _haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat, dlon = p2 - p1, math.radians(lon2 - lon1)
    return EARTH_KM * 2 * math.asin(math.sqrt(
        math.sin(dlat / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2))


def build_nearby(records: list[dict], anchor_id: str,
                 radius_km: float = 40.0) -> dict | None:
    """Neighbors of `anchor_id` within radius; None when the id is unknown."""
    anchor = next((r for r in records if r.get("overlap_id") == anchor_id), None)
    if not anchor:
        return None
    mp = anchor.get("midpoint")
    if not mp:
        return {"overlap_id": anchor_id, "neighbors": [],
                "note": "anchor record has no midpoint"}
    out = []
    for r in records:
        if r.get("overlap_id") == anchor_id:
            continue
        m2 = r.get("midpoint")
        if not m2:
            continue
        d = _haversine_km(mp[0], mp[1], m2[0], m2[1])
        if d <= radius_km:
            out.append({
                "overlap_id": r["overlap_id"], "distance_km": round(d, 2),
                "tier": r["tier"], "utilities": r.get("utilities"),
                "timeline_overlap": r.get("timeline_overlap"),
                "shared_window": r.get("shared_window"),
            })
    out.sort(key=lambda x: x["distance_km"])
    return {
        "overlap_id": anchor_id,
        "midpoint": mp,
        "radius_km": radius_km,
        "neighbor_count": len(out),
        "neighbors": out[:60],
    }
