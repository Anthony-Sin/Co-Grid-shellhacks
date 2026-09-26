"""Scoring, explanations, and rough cost estimates for overlap records.

Ranking (per challenge brief): distance tier is the primary key, exact
distance second, timeline overlap third. `score` is a 0-100 display value
derived from the same signals — sorting uses the tuple, not the score.

Cost model: all constants live in src/spatial/costmodel.py — the analysis
impact endpoint uses the same module, so stored `cost` and
/api/analysis/impact can never quote divergent numbers.
"""
from __future__ import annotations

import geopandas as gpd

from .costmodel import (LAND_SHARE_MAX_TIER, LOGISTICS_BASIS,
                        corridor_km, estimate_row_savings, row_width_m)
from .schema import OverlapRecord

# --- Scoring weights -------------------------------------------------------
_TIER_SCORE = {1: 55.0, 2: 45.0, 3: 30.0, 4: 15.0}
_TIMELINE_BONUS = 25.0      # true window intersection — crews co-present
_ADJACENT_BONUS = 12.0      # windows roll end-to-start — weaker signal
_VOLTAGE_BONUS_CAP = 10.0   # higher-voltage work is harder to reschedule


def _distance_component(distance_km: float, tier: int) -> float:
    """0-10 points inside the tier: closer to the inner bound = higher."""
    lo, hi = {1: (0.0, 0.03), 2: (0.03, 1.6), 3: (1.6, 8.0), 4: (8.0, 40.0)}[tier]
    frac = 1.0 - (distance_km - lo) / max(hi - lo, 1e-9)
    return max(0.0, min(1.0, frac)) * 10.0


def _voltage_bonus(r: OverlapRecord) -> float:
    """Real signal: higher-voltage corridors constrain outage windows
    more, so coordination is worth more. 500 kV -> 10, 230 kV -> 4.6,
    115 kV -> 2.3; unfiled voltage -> 0."""
    return min(_VOLTAGE_BONUS_CAP, (r.max_voltage_kv or 0.0) * 0.02)


def score_overlaps(records: list[OverlapRecord]) -> list[OverlapRecord]:
    """Fill `score` and sort: tier asc, distance asc, timeline first."""
    for r in records:
        r.score = round(
            _TIER_SCORE[r.tier]
            + _distance_component(r.min_distance_km, r.tier)
            + (_TIMELINE_BONUS if r.timeline_overlap
               else _ADJACENT_BONUS if r.timeline_adjacent else 0.0)
            + _voltage_bonus(r),
            1,
        )
    records.sort(key=lambda r: (r.tier, r.min_distance_km, not r.timeline_overlap))
    for i, r in enumerate(records, 1):
        r.overlap_id = f"OV-{i:04d}"
    return records


def attach_explanations(records: list[OverlapRecord], gdf: gpd.GeoDataFrame) -> None:
    by_id = {row.project_id: row for row in gdf.itertuples()}
    for r in records:
        a, b = by_id.get(r.project_a), by_id.get(r.project_b)
        if a is None or b is None:
            continue
        if r.timeline_overlap and r.shared_window:
            win = f" Build windows intersect {r.shared_window['start']}–{r.shared_window['end']}."
        elif r.timeline_adjacent and r.adjacent_window:
            aw = r.adjacent_window
            win = (f" Build windows are adjacent ({aw['start']}–{aw['end']} "
                   "handoff) — crews could roll between sites, but no "
                   "concurrent shared window exists.")
        else:
            win = " Build windows do NOT overlap — coordination value limited."
        r.explanation = (
            f"{a.utility} '{a.name}' passes {r.min_distance_km} km from "
            f"{b.utility} '{b.name}' (tier {r.tier}: {r.tier_label}).{win}"
        )


def attach_costs(records: list[OverlapRecord], gdf: gpd.GeoDataFrame) -> None:
    """Attach a rough cost/impact estimate (challenge bonus deliverable).

    Only tiers 1-2 get land/ROW numbers (tiers 3-4 share logistics & crews —
    noted as such, no invented acreage). Constants shared with
    src/analysis/impact.py via costmodel.
    """
    by_id = {row.project_id: row for row in gdf.itertuples()}
    for r in records:
        a, b = by_id.get(r.project_a), by_id.get(r.project_b)
        if a is None or b is None:
            continue
        if r.tier <= LAND_SHARE_MAX_TIER:
            km = corridor_km(a.geometry, b.geometry)
            width = row_width_m(a.voltage_kv, b.voltage_kv)
            est = estimate_row_savings(km, width)
            r.cost = {
                "shared_row_km": km,
                "shared_row_acres": est["acres"],
                "est_savings_usd_low": est["low"],
                "est_savings_usd_high": est["high"],
                "basis": est["basis"],
            }
        else:
            r.cost = {
                "shared_row_km": 0.0,
                "shared_row_acres": 0.0,
                "est_savings_usd_low": 0,
                "est_savings_usd_high": 0,
                "basis": LOGISTICS_BASIS,
            }
