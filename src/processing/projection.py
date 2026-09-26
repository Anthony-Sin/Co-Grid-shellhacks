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
