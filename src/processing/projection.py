"""WGS84 -> scene-local meters. Mirrors src/ui/src/lib/projection.ts exactly."""
from __future__ import annotations

import math
from typing import Sequence

SCENES: dict[str, dict] = {
    "savannah": {
        "center": (-81.10, 32.13),
        "bbox": (-81.55, 31.95, -80.75, 32.45),  # min_lon,min_lat,max_lon,max_lat
    },
    "augusta": {
        "center": (-81.97, 33.45),
        "bbox": (-82.30, 33.25, -81.60, 33.65),
    },
    # Additional GA/SC urban cores — tight downtown-scale bboxes (~13-22 km
    # across, NOT whole metro areas) so the state scene composites real
    # building density beyond the Savannah/Augusta corridors.
    "atlanta": {
        # Downtown + Midtown + GA Tech + Decatur west edge + S Buckhead.
        # core_radius_m tightened (8 km vs the 13 km default) so the
        # 175k-building pull stays inside the artifact size budget —
        # outside 8 km only tall/named/civic/industrial survive (same
        # density-shaping rule as the other scenes).
        "center": (-84.39, 33.755),
        "bbox": (-84.50, 33.67, -84.28, 33.85),
        "core_radius_m": 8_000,
        "max_roads": 30_000,
    },
    "columbia": {
        # Downtown SC, USC, West Columbia/Cayce, Forest Acres.
        "center": (-81.035, 34.000),
        "bbox": (-81.13, 33.93, -80.95, 34.07),
    },
    "charleston": {
        # Peninsula + North Charleston + Daniel Island + Mt. Pleasant
        # west bank — one bbox covers Charleston & N. Charleston cores.
        "center": (-79.94, 32.80),
        "bbox": (-80.03, 32.70, -79.85, 32.90),
    },
    "greenville_sc": {
        # Downtown Greenville SC + immediate inner suburbs.
        "center": (-82.395, 34.845),
        "bbox": (-82.47, 34.77, -82.32, 34.92),
    },
    "columbus_ga": {
        # Downtown Columbus + Phenix City (AL) across the Chattahoochee.
        "center": (-84.99, 32.46),
        "bbox": (-85.07, 32.38, -84.91, 32.54),
    },
    "athens": {
        # UGA campus + downtown Athens + inner metro core.
        "center": (-83.38, 33.955),
        "bbox": (-83.45, 33.895, -83.31, 34.015),
    },
    "macon": {
        # Downtown Macon + Ocmulgee river corridor.
        "center": (-83.635, 32.84),
        "bbox": (-83.72, 32.75, -83.55, 32.93),
    },
    # Full Georgia + South Carolina envelope (zoomed-out state scene).
    "state": {
        "center": (-81.85, 32.78),
        "bbox": (-85.70, 30.30, -78.00, 35.25),
    },
}

_M_PER_DEG_LAT = 110_540.0
_M_PER_DEG_LON = 111_320.0


def lonlat_to_local(lon: float, lat: float, center: Sequence[float]) -> tuple[float, float]:
    c0, c1 = center
    x = (lon - c0) * _M_PER_DEG_LON * math.cos(math.radians(c1))
    y = (lat - c1) * _M_PER_DEG_LAT
    return (round(x, 2), round(y, 2))


def local_to_lonlat(x: float, y: float, center: Sequence[float]) -> tuple[float, float]:
    c0, c1 = center
    lon = x / (_M_PER_DEG_LON * math.cos(math.radians(c1))) + c0
    lat = y / _M_PER_DEG_LAT + c1
    return (lon, lat)


def in_bbox(lon: float, lat: float, bbox: Sequence[float], pad: float = 0.0) -> bool:
    return (
        bbox[0] - pad <= lon <= bbox[2] + pad
        and bbox[1] - pad <= lat <= bbox[3] + pad
    )


def scene_for_zone(zone: str | None) -> str:
    """Zone tag -> best-fit UI scene for deep links. Shared by the agent's
    deep_link fields and the /api/overlaps.csv map_link column."""
    z = (zone or "").lower()
    if "savannah" in z:
        return "savannah"
    if "augusta" in z:
        return "augusta"
    return "state"
