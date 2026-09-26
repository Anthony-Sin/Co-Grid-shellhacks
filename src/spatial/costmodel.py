"""Shared cost model — ONE set of planning assumptions for every surface.

Both src/spatial/ranker.py (stored `cost` on overlap records) and
src/analysis/impact.py (on-demand impact endpoint) must quote the SAME
numbers — two divergent models on different surfaces is worse than a
conservative one. All constants are public-domain planning bounds:

- Rural GA/SC corridor land: ~$8k-25k / acre
- Avoided second-corridor establishment (survey, permits, access roads,
  clearing): ~$150k-400k / km — the "share the land itself" value
- ROW widths: ~45 m for <230 kV corridors, ~60 m for 230 kV+

IMPORTANT domain rule (challenge spec): only tiers 1-2 can share land /
right-of-way. Tiers 3-4 share logistics and crews — acreage/savings are
meaningless at 8-40 km separation and must NOT be quantified there.
"""
from __future__ import annotations

from typing import Optional

M2_PER_ACRE = 4046.86

LAND_USD_PER_ACRE = (8_000, 25_000)
CORRIDOR_SAVINGS_USD_PER_KM = (150_000, 400_000)
ROW_WIDTH_115KV_M = 45.0
ROW_WIDTH_230KV_M = 60.0
# A geometry lying inside this band of the other project is treated as
# physically co-locatable in one corridor (a shared-ROW segment).
ROW_PROXIMITY_BAND_M = 200.0

# Tiers eligible for land/ROW sharing — everything else is logistics/crews.
LAND_SHARE_MAX_TIER = 2


def row_width_m(*voltage_kv: Optional[float]) -> float:
    """ROW width by the highest filed voltage (None -> 115 kV class)."""
    kv = max((v for v in voltage_kv if v is not None), default=None)
    return ROW_WIDTH_230KV_M if kv is not None and kv >= 230 else ROW_WIDTH_115KV_M


def corridor_km(geom_a_m, geom_b_m) -> float:
    """Length of the shorter geometry lying within the co-location band of
    the other — the segment that could share one right-of-way."""
    if geom_a_m is None or geom_b_m is None:
        return 0.0
    shared = geom_a_m.intersection(geom_b_m.buffer(ROW_PROXIMITY_BAND_M))
    km = getattr(shared, "length", 0.0) / 1000.0
    la = getattr(geom_a_m, "length", 0.0) / 1000.0
    lb = getattr(geom_b_m, "length", 0.0) / 1000.0
    return round(min(km, la, lb), 3)


def estimate_row_savings(corridor_km: float, width_m: float) -> dict:
    """Land + avoided-corridor savings for a co-locatable segment."""
    acres = round(corridor_km * 1000 * width_m / M2_PER_ACRE, 1)
    l_lo, l_hi = LAND_USD_PER_ACRE
    c_lo, c_hi = CORRIDOR_SAVINGS_USD_PER_KM
    return {
        "acres": acres,
        "low": int(acres * l_lo + corridor_km * c_lo),
        "high": int(acres * l_hi + corridor_km * c_hi),
        "basis": (
            f"~{corridor_km} km co-locatable corridor x {width_m:.0f} m ROW; "
            "land $8-25k/acre + $150-400k/km avoided corridor establishment. "
            "Rough order-of-magnitude planning figure, not an engineering "
            "cost estimate."
        ),
    }


LOGISTICS_BASIS = (
    "Tier 3-4: value is shared logistics/crews (laydown yards, "
    "mobilization, deliveries) — typically 5-15% of combined mobilization "
    "cost; no land sharing quantified at this separation."
)
