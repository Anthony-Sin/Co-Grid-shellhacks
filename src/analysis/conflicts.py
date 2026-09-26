"""Outage-coordination conflicts — the must-schedule subset.

Tier 1 (touching/crossing) means the builds physically interact: shared
structures, crossing spans, or the same de-energized line. When those
records also share a build window, the utilities MUST jointly schedule
outages or one project will hold the other's construction window.

This endpoint isolates exactly that subset and buckets it by shared
window year so a scheduler sees "how many joint outages must be agreed
for 2026" — the operational answer, not the planning one.

Deterministic. Reads the processed overlap artifact only.
"""

from __future__ import annotations


def build_conflicts(overlaps_data: dict) -> dict:
    records = overlaps_data.get("overlaps") or []
    hard = [
        r for r in records
        if r.get("tier") == 1 and r.get("timeline_overlap")
        and (r.get("shared_window") or {}).get("start") is not None
    ]
    by_year: dict[int, list[str]] = {}
    for r in hard:
        w = r["shared_window"]
        for y in range(int(w["start"]), int(w["end"]) + 1):
            by_year.setdefault(y, []).append(r["overlap_id"])

    seasons = [
        {"year": y, "overlap_ids": sorted(set(ids)), "count": len(set(ids))}
        for y, ids in sorted(by_year.items())
    ]
    for s in seasons:
        s["utility_pairs"] = sorted({
            " × ".join(sorted(r.get("utilities") or []))
            for r in hard if r["overlap_id"] in s["overlap_ids"]
        })

    return {
        "conflict_count": len(hard),
        "definition": ("tier 1 (touching/crossing) AND intersecting build "
                       "window — joint outage scheduling is mandatory, "
                       "not optional"),
        "seasons": seasons,
        "overlaps": [
            {
                "overlap_id": r["overlap_id"],
                "project_a": r.get("project_a"),
                "project_b": r.get("project_b"),
                "utilities": r.get("utilities"),
                "shared_window": r.get("shared_window"),
                "min_distance_km": r.get("min_distance_km"),
                "score": r.get("score"),
            }
            for r in sorted(hard, key=lambda x: x.get("score", 0), reverse=True)
        ],
        "note": ("The remaining tier-1 records without shared windows are "
                 "structural constraints only — they still need crossing "
                 "agreements but not synchronized outages."),
    }
