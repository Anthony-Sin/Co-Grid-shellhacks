"""Scoring, explanations, and rough cost estimates for overlap records.

Ranking (per challenge brief): distance tier is the primary key, exact
distance second, timeline overlap third. `score` is a 0-100 display value
derived from the same signals — sorting uses the tuple, not the score.
"""
from __future__ import annotations

import geopandas as gpd

from .schema import OverlapRecord

# --- Scoring weights -------------------------------------------------------
_TIER_SCORE = {1: 55.0, 2: 45.0, 3: 30.0, 4: 15.0}
_TIMELINE_BONUS = 25.0
_VOLTAGE_BONUS_CAP = 10.0

# --- Cost model (rough, documented, public-domain assumptions) --------------
# Rural GA/SC raw land inside a transmission corridor: ~$8k-25k / acre.
_LAND_LOW, _LAND_HIGH = 8_000, 25_000
# Shared ROW is assumed 30 m wide where two lines could co-locate.
_ROW_WIDTH_M = 30.0
_M2_PER_ACRE = 4046.86
# Carrying one fewer separate corridor for N km saves surveying,
# permitting, access-road and clearing work: ~$150k-400k / km (very rough).
_CORRIDOR_SAVINGS_LOW, _CORRIDOR_SAVINGS_HIGH = 150_000, 400_000


def _distance_component(distance_km: float, tier: int) -> float:
    """0-10 points inside the tier: closer to the inner bound = higher."""
    lo, hi = {1: (0.0, 0.03), 2: (0.03, 1.6), 3: (1.6, 8.0), 4: (8.0, 40.0)}[tier]
    frac = 1.0 - (distance_km - lo) / max(hi - lo, 1e-9)
    return max(0.0, min(1.0, frac)) * 10.0


def score_overlaps(records: list[OverlapRecord]) -> list[OverlapRecord]:
    """Fill `score` and sort: tier asc, distance asc, timeline first."""
    for r in records:
        r.score = round(
            _TIER_SCORE[r.tier]
            + _distance_component(r.min_distance_km, r.tier)
            + (_TIMELINE_BONUS if r.timeline_overlap else 0.0)
            + min(_VOLTAGE_BONUS_CAP, 5.0),  # shared-grid work is high-voltage
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
        win = ""
        if r.timeline_overlap and r.shared_window:
            win = f" Build windows intersect {r.shared_window['start']}–{r.shared_window['end']}."
        elif not r.timeline_overlap:
            win = " Build windows do NOT overlap — coordination value limited."
        r.explanation = (
            f"{a.utility} '{a.name}' passes {r.min_distance_km} km from "
            f"{b.utility} '{b.name}' (tier {r.tier}: {r.tier_label}).{win}"
        )


def _corridor_km(geom_a, geom_b) -> float:
    """Length of the shorter geometry lying near the other (co-location
    potential). Uses a 100 m proximity band as the 'could share ROW' test."""
    near_band = geom_b.buffer(100.0)
    shared = geom_a.intersection(near_band)
    km = getattr(shared, "length", 0.0) / 1000.0
    return round(min(km, geom_a.length / 1000.0, geom_b.length / 1000.0), 2)


def attach_costs(records: list[OverlapRecord], gdf: gpd.GeoDataFrame) -> None:
    """Attach a rough cost/impact estimate (challenge bonus deliverable).

    Only tiers 1-2 get land/ROW numbers (tiers 3-4 share logistics & crews —
    noted as such, no invented acreage).
    """
    by_id = {row.project_id: row for row in gdf.itertuples()}
    for r in records:
        a, b = by_id.get(r.project_a), by_id.get(r.project_b)
        if a is None or b is None:
            continue
        if r.tier <= 2:
            corridor_km = _corridor_km(a.geometry, b.geometry)
            acres = round(corridor_km * 1000 * _ROW_WIDTH_M / _M2_PER_ACRE, 1)
            lo = int(acres * _LAND_LOW + corridor_km * _CORRIDOR_SAVINGS_LOW)
            hi = int(acres * _LAND_HIGH + corridor_km * _CORRIDOR_SAVINGS_HIGH)
            r.cost = {
                "shared_row_km": corridor_km,
                "shared_row_acres": acres,
                "est_savings_usd_low": lo,
                "est_savings_usd_high": hi,
                "basis": (
                    f"~{corridor_km} km of co-locatable corridor x {_ROW_WIDTH_M:.0f} m ROW; "
                    "land $8-25k/acre + $150-400k/km avoided corridor costs. Rough order-of-"
                    "magnitude planning figure, not an engineering estimate."
                ),
            }
        else:
            r.cost = {
                "shared_row_km": 0.0,
                "shared_row_acres": 0.0,
                "est_savings_usd_low": 0,
                "est_savings_usd_high": 0,
                "basis": "Tier 3-4: value is shared logistics/crews (laydown yards, "
                "mobilization) — typically 5-15% of combined mobilization cost; "
                "no land sharing quantified.",
            }
