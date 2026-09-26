"""Coordination calendar — overlaps bucketed by shared-window start year.

Shared by `/api/analysis/calendar` and the agent's `season_calendar`
tool so the two surfaces can never diverge. Only TRUE window
intersections are scheduled into a year; end-to-start adjacency is
counted separately (AGENTS.md §8 — adjacency is not concurrency).
"""
from __future__ import annotations


def build_calendar(rows: list[dict]) -> dict:
    """Bucket overlap records by shared-window start year (score-sorted)."""
    years: dict[str, list[dict]] = {}
    no_window = 0
    adjacent_only = 0
    for r in rows:
        win = r.get("shared_window") or {}
        start = win.get("start")
        if start is None or not r.get("timeline_overlap"):
            # adjacent windows have no concurrent window — they are counted
            # separately, never scheduled into a season year.
            if r.get("timeline_adjacent"):
                adjacent_only += 1
            else:
                no_window += 1
            continue
        years.setdefault(str(int(start)), []).append({
            "overlap_id": r.get("overlap_id"),
            "utilities": r.get("utilities"),
            "tier": r.get("tier"),
            "tier_label": r.get("tier_label"),
            "min_distance_km": r.get("min_distance_km"),
            "window": {"start": win.get("start"), "end": win.get("end")},
            "score": r.get("score"),
        })
    for v in years.values():
        v.sort(key=lambda x: -(x.get("score") or 0))
    return {
        "metric": "coordination_calendar",
        "by_start_year": dict(sorted(years.items())),
        "overlaps_without_window": no_window,
        "adjacent_only": adjacent_only,
        "note": ("grouped by shared-window start year — only true window "
                 "intersections are scheduled; adjacent (roll-over) windows "
                 "are counted separately, never placed in a season"),
    }
