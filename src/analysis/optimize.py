"""Coordination playbook — turns overlaps + shared windows into an executable
joint-work plan.

The question it answers: "if the utilities ran a shared program, what would
each season look like?" Deterministic, no model:

  1. staging clusters (union-find on midpoints, crew-yard radius)
  2. per cluster, per calendar year — which member sites have a shared
     build window covering that year  ->  "seasons"
  3. greedy set-cover picks the minimum season-years covering the cluster
  4. honest metrics: concurrent-site peak (crew sizing signal), window
     span, tier mix. No invented dollar figures — savings detail lives
     in /api/analysis/impact per record.

Reads processed artifacts only. Read-only.
"""

from __future__ import annotations

from .clusters import build_clusters

_TIER_WEIGHT = {1: 4, 2: 3, 3: 2, 4: 1}


def _window_years(rec: dict) -> set[int]:
    w = rec.get("shared_window") or {}
    a, b = w.get("start"), w.get("end")
    if isinstance(a, int) and isinstance(b, int) and a <= b:
        return set(range(a, b + 1))
    return set()


def build_playbook(overlaps_data: dict, radius_km: float = 40.0,
                   top_clusters: int = 10) -> dict:
    """Season plan per staging cluster, ordered by coordination value."""
    records = overlaps_data.get("overlaps") or []
    if not records:
        return {"clusters": [], "note": "no overlap records available"}

    clusters = build_clusters(overlaps_data, radius_km).get("clusters", [])
    by_id = {r["overlap_id"]: r for r in records}

    out: list[dict] = []
    for cl in clusters[: max(1, top_clusters)]:
        members = [by_id[i] for i in cl["overlap_ids"] if i in by_id]

        # year -> overlaps buildable that year (window covers it)
        year_map: dict[int, list[str]] = {}
        unscheduled: list[str] = []
        for m in members:
            yrs = _window_years(m)
            if not yrs:
                unscheduled.append(m["overlap_id"])
                continue
            for y in yrs:
                year_map.setdefault(y, []).append(m["overlap_id"])

        # greedy set-cover: pick the year covering the most still-uncovered sites
        uncovered = {m["overlap_id"] for m in members} - set(unscheduled)
        seasons: list[dict] = []
        while uncovered:
            best_year, best_ids = max(
                year_map.items(), key=lambda kv: len(set(kv[1]) & uncovered))
            cover = sorted(set(best_ids) & uncovered)
            if not cover:
                break
            tier_mix = sorted({by_id[i]["tier"] for i in cover})
            seasons.append({
                "year": best_year,
                "overlap_ids": cover,
                "site_count": len(cover),
                "tiers": tier_mix,
                "value_score": sum(_TIER_WEIGHT.get(by_id[i]["tier"], 1)
                                   for i in cover),
            })
            uncovered -= set(cover)

        seasons.sort(key=lambda s: (-s["site_count"], s["year"]))
        peak = max((len(v) for v in year_map.values()), default=0)
        out.append({
            "cluster_id": cl["cluster_id"],
            "centroid": cl["centroid"],
            "span_km": cl["span_km"],
            "site_count": cl["size"],
            "utilities": cl["utilities_involved"],
            "tiers_present": cl["tiers_present"],
            "seasons": seasons,
            "unscheduled_overlap_ids": unscheduled,
            "peak_concurrent_sites": peak,
        })

    out.sort(key=lambda c: (-c["site_count"], -c["peak_concurrent_sites"]))
    return {
        "radius_km": radius_km,
        "cluster_count": len(clusters),
        "clusters": out,
        "note": (
            "Seasons = minimal set of calendar years covering all windowed "
            "sites in a cluster (greedy set-cover). peak_concurrent_sites is "
            "the largest single-year workload — the crew-sizing signal. "
            "Unscheduled sites lack build windows in source data."
        ),
    }
