"""Timeline analytics over the processed artifacts (pure functions).

Consumes already-loaded `projects.geojson` + `overlaps.json` dicts — no I/O.

Honesty rules (AGENTS.md §7):
- Only projects with BOTH start_year and end_year filed are counted in the
  year/quarter bands; the skipped count is reported, never silently dropped.
- Overlaps with no shared_window contribute nothing to "active" counts and
  are reported separately as `overlaps_without_window`.
"""
from __future__ import annotations

from typing import Optional

# Window-length buckets required by the challenge analysis brief:
#   "0yr/none"  -> no shared_window OR a 0-length (same-year) window
#   "<1yr"      -> 0 < length < 1 (fractional only; integer-year windows
#                  land at exactly 0, handled by the first bucket)
#   "1-3yr"     -> 1 <= length <= 3
#   ">3yr"      -> length > 3
WINDOW_BUCKETS = ("none_or_0yr", "lt_1yr", "1_to_3yr", "gt_3yr")


# --- normalization helpers --------------------------------------------------

def _features(projects) -> list[dict]:
    """Accept a FeatureCollection dict or a bare feature list."""
    if isinstance(projects, dict):
        return projects.get("features", [])
    return list(projects or [])


def _overlap_rows(overlaps) -> list[dict]:
    """Accept an overlaps.json dict or a bare overlap list."""
    if isinstance(overlaps, dict):
        return overlaps.get("overlaps", [])
    return list(overlaps or [])


def _dated_window(props: dict) -> Optional[tuple[int, int]]:
    """(start, end) only when BOTH years are filed — else None (honest skip)."""
    s, e = props.get("start_year"), props.get("end_year")
    if s is None or e is None:
        return None
    return (min(int(s), int(e)), max(int(s), int(e)))


def _window_length(sw: Optional[dict]) -> Optional[int]:
    if not sw or sw.get("start") is None or sw.get("end") is None:
        return None
    return int(sw["end"]) - int(sw["start"])


# --- band builders ------------------------------------------------------------

def _band(feats: list[dict], ov_rows: list[dict], granularity: str) -> dict:
    """Shared implementation for yearly_band()/quarters().

    granularity: "year" -> keys are ints (2027); "quarter" -> "2027Q1".
    A project filed [start,end] spans its window evenly — active in every
    year/quarter of the inclusive range. Overlaps activate on their
    shared_window (also inclusive).
    """
    def label(y: int, q: Optional[int]):
        return y if granularity == "year" else f"{y}Q{q}"

    def units(win: tuple[int, int]) -> list:
        if granularity == "year":
            return [label(y, None) for y in range(win[0], win[1] + 1)]
        return [label(y, q) for y in range(win[0], win[1] + 1) for q in range(1, 5)]

    dated, skipped = [], 0
    for f in feats:
        win = _dated_window(f.get("properties", {}))
        if win is None:
            skipped += 1
        else:
            dated.append((win, f["properties"].get("utility", "?")))
    ov_wins = [o.get("shared_window") for o in ov_rows]
    ov_dated = [
        (int(w["start"]), int(w["end"])) for w in ov_wins
        if w and w.get("start") is not None and w.get("end") is not None
    ]
    ov_skipped = len(ov_rows) - len(ov_dated)

    lo = min([w[0] for w, _ in dated] + [w[0] for w in ov_dated], default=None)
    hi = max([w[1] for w, _ in dated] + [w[1] for w in ov_dated], default=None)
    rows = []
    if lo is not None:
        for key in units((lo, hi)):
            by_util: dict[str, int] = {}
            for win, util in dated:
                if key in units(win):
                    by_util[util] = by_util.get(util, 0) + 1
            rows.append({
                granularity: key,
                "by_utility": by_util,
                "total": sum(by_util.values()),
                "overlaps_active": sum(
                    1 for w in ov_dated if key in units(w)
                ),
            })
    return {
        "span": {"start": lo, "end": hi},
        "rows": rows,
        "projects_counted": len(dated),
        "projects_skipped_missing_dates": skipped,
        "overlaps_counted": len(ov_dated),
        "overlaps_without_window": ov_skipped,
    }


def yearly_band(feats: list[dict], ov_rows: list[dict]) -> dict:
    """Per-year active-project counts (by utility + total) and count of
    overlaps whose shared window covers that year."""
    return _band(feats, ov_rows, "year")


def quarters(feats: list[dict], ov_rows: list[dict]) -> dict:
    """Same band shape by quarter ("2027Q1"), assuming each project spans
    its filed window evenly — active every quarter [start]Q1..[end]Q4."""
    return _band(feats, ov_rows, "quarter")


# --- shared-window stats -------------------------------------------------------

def windows(ov_rows: list[dict]) -> dict:
    """Per-overlap shared build window + length distribution + longest."""
    per: list[dict] = []
    buckets = {b: 0 for b in WINDOW_BUCKETS}
    longest: Optional[dict] = None
    for o in ov_rows:
        sw = o.get("shared_window")
        length = _window_length(sw)
        if length is None or length == 0:
            buckets["none_or_0yr"] += 1
        elif length < 1:
            buckets["lt_1yr"] += 1
        elif length <= 3:
            buckets["1_to_3yr"] += 1
        else:
            buckets["gt_3yr"] += 1
        per.append({
            "overlap_id": o.get("overlap_id"),
            "project_a": o.get("project_a"),
            "project_b": o.get("project_b"),
            "timeline_overlap": bool(o.get("timeline_overlap")),
            "shared_window": sw,
            "window_length_years": length,
        })
        if length is not None and (longest is None or length > longest["length_years"]):
            longest = {
                "overlap_id": o.get("overlap_id"),
                "start": sw["start"],
                "end": sw["end"],
                "length_years": length,
            }
    return {
        "per_overlap": per,
        "longest_shared_window": longest,
        "buckets": buckets,
        "count": len(per),
    }


# --- public entry point ---------------------------------------------------------

def build_timeline(projects, overlaps) -> dict:
    """Single JSON-serializable dict consumed by the API + tests."""
    feats, ov_rows = _features(projects), _overlap_rows(overlaps)
    return {
        "metric": "build_timeline",
        "yearly": yearly_band(feats, ov_rows),
        "quarterly": quarters(feats, ov_rows),
        "windows": windows(ov_rows),
        "notes": [
            "Bands count only projects with BOTH start_year and end_year filed;",
            " skipped totals are reported per band.",
            "Projects are assumed active across their whole filed window",
            " (every quarter of [start_year, end_year], inclusive).",
            "overlaps_active counts overlaps whose shared_window covers the",
            " period; overlaps with no shared_window are never forced in.",
        ],
    }
