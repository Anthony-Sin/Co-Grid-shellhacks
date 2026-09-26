"""Distance-tier classification — the challenge's immutable ranking rules.

| Tier | Closest-point distance | Label            |
|------|------------------------|------------------|
| 1    | 0 (touching/crossing)  | touching         |
| 2    | < 1.6 km               | shared_row       |
| 3    | < 8 km                 | shared_logistics |
| 4    | < 40 km                | shared_crews     |
"""
from __future__ import annotations

from typing import Optional

from .schema import TIER_LABELS

MAX_DISTANCE_KM = 40.0
TIER2_KM = 1.6
TIER3_KM = 8.0
# Anything below this counts as "touching" (≈30 m — crossing structures,
# shared poles, or geometry vertex snapping).
TOUCHING_EPS_KM = 0.03


def classify_tier(distance_km: float) -> Optional[int]:
    """Return tier 1-4 for a closest-point distance, or None if > 40 km."""
    if distance_km <= TOUCHING_EPS_KM:
        return 1
    if distance_km < TIER2_KM:
        return 2
    if distance_km < TIER3_KM:
        return 3
    if distance_km < MAX_DISTANCE_KM:
        return 4
    return None


def tier_threshold_km(tier: int) -> float:
    """Upper bound of the tier (Tier 1's bound is the touching epsilon)."""
    return {1: TOUCHING_EPS_KM, 2: TIER2_KM, 3: TIER3_KM, 4: MAX_DISTANCE_KM}[tier]


def tier_label(tier: int) -> str:
    return TIER_LABELS[tier]
