"""Deterministic executive summary — headline numbers composed from the
processed artifacts. No model involved; the API route and the agent tool
both call build_summary() so numbers can't drift between surfaces.
"""
from __future__ import annotations

from .conflicts import build_conflicts


def build_summary(projects_fc: dict, overlaps_payload: dict) -> dict:
    """Compose program-level headline numbers.

    Args:
        projects_fc: processed projects.geojson FeatureCollection payload
        overlaps_payload: processed overlaps.json payload
    """
    records = overlaps_payload.get("overlaps") or []
    projs = projects_fc.get("features", [])

    pairs: dict[str, dict] = {}
    for r in records:
        key = " × ".join(sorted(set(r.get("utilities") or []))) or "unknown"
        cell = pairs.setdefault(key, {"utilities": sorted(set(r.get("utilities") or [])),
                                      "overlaps": 0})
        cell["overlaps"] += 1
    top_pair = max(pairs.values(), key=lambda c: c["overlaps"], default=None)

    year_counts: dict[str, int] = {}
    for r in records:
        win = r.get("shared_window") or {}
        if r.get("timeline_overlap") and win.get("start") is not None:
            y = str(int(win["start"]))
            year_counts[y] = year_counts.get(y, 0) + 1
    peak_year, peak_n = max(year_counts.items(), key=lambda kv: kv[1],
                            default=(None, 0))

    conf = build_conflicts(overlaps_payload)
    best = max(records, key=lambda r: r.get("score") or 0, default=None)
    return {
        "metric": "executive_summary",
        "projects": len(projs),
        "overlaps": len(records),
        "tier1_touching": sum(1 for r in records if r["tier"] == 1),
        # true window intersections only — adjacent roll-overs counted apart
        "timeline_matches": sum(1 for r in records if r.get("timeline_overlap")),
        "timeline_adjacent": sum(1 for r in records if r.get("timeline_adjacent")),
        "utility_pairs": len(pairs),
        "dominant_pair": {
            "utilities": top_pair["utilities"],
            "overlaps": top_pair["overlaps"],
        } if top_pair else None,
        "peak_season_year": peak_year,
        "peak_season_openings": peak_n,
        "mandatory_joint_outages": conf.get("conflict_count"),
        "top_opportunity": {
            "overlap_id": best["overlap_id"],
            "utilities": best.get("utilities"),
            "tier": best["tier"],
            "score": best.get("score"),
            "shared_window": best.get("shared_window"),
        } if best else None,
    }
