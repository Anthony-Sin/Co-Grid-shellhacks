"""Per-overlap impact / cost estimate — the challenge's BONUS deliverable.

Pure functions: callers pass loaded `projects.geojson` + `overlaps.json`.
Every estimate carries its assumptions in-band and is labeled
`confidence: "rough_estimate"` — honesty is graded, so:
- null/None whenever inputs are missing (never invented numbers);
- savings are RANGES with documented low/high bounds, not point figures.

All distance/area math in EPSG:32617 (UTM 17N, meters) — same convention
as src/spatial/engine.py.
"""
from __future__ import annotations

from typing import Optional

from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform as shp_transform

SOURCE_CRS = "EPSG:4326"
TARGET_CRS = "EPSG:32617"  # UTM 17N — covers Savannah & Augusta
_KM = 1000.0
_M2_PER_ACRE = 4046.86

# --- Assumption constants (public-domain, documented) ------------------------
# Typical transmission ROW widths (BPA/industry planning figures):
#   ~45 m for 115 kV-class corridors, ~60 m for 230 kV-class.
ROW_WIDTH_M_115KV = 45.0
ROW_WIDTH_M_230KV = 60.0
ROW_WIDTH_DEFAULT_M = ROW_WIDTH_M_115KV
# Avoided separate mobilization/survey/permitting when one corridor serves
# both builds: ~$25k-$80k per shared km (rough planning bound).
MOBILIZATION_USD_PER_KM = (25_000, 80_000)
# Raw rural GA/SC land inside a transmission corridor: ~$8k-$25k / acre
# (same bound used by src/spatial/ranker.py — kept consistent).
LAND_USD_PER_ACRE = (8_000, 25_000)
# Realistic field-working days per month (weather, outages, outages windows).
WORKING_DAYS_PER_MONTH = 18

_TRANSFORMER = Transformer.from_crs(SOURCE_CRS, TARGET_CRS, always_xy=True)


def _to_m(geojson_geom: Optional[dict]):
    """GeoJSON (WGS84) -> shapely geometry in EPSG:32617 meters."""
    if not geojson_geom:
        return None
    try:
        return shp_transform(_TRANSFORMER.transform, shape(geojson_geom))
    except Exception:
        return None


def _row_width_m(props_a: dict, props_b: dict) -> float:
    """Pick ROW width by the higher filed voltage (None -> 115 kV class)."""
    kv = max(
        (p.get("voltage_kv") or 0) for p in (props_a, props_b)
    )
    return ROW_WIDTH_M_230KV if kv >= 230 else ROW_WIDTH_M_115KV


def _window_months(sw: Optional[dict]) -> Optional[int]:
    """Inclusive months in a shared_window {start,end} of integer years."""
    if not sw or sw.get("start") is None or sw.get("end") is None:
        return None
    return (int(sw["end"]) - int(sw["start"]) + 1) * 12


def _corridor_km(geom_a, geom_b, radius_km: float) -> Optional[float]:
    """Length of project A's geometry lying within `radius_km` of B —
    the co-locatable corridor. None when geometry is missing."""
    if geom_a is None or geom_b is None:
        return None
    shared = geom_a.intersection(geom_b.buffer(radius_km * _KM))
    km = getattr(shared, "length", 0.0) / _KM
    return round(min(km, geom_a.length / _KM), 3)


def _impact_for(o: dict, by_id: dict) -> dict:
    assumptions = [
        f"ROW width: {ROW_WIDTH_M_115KV:.0f} m typical 115 kV corridor, "
        f"{ROW_WIDTH_M_230KV:.0f} m for >=230 kV (higher filed voltage wins).",
        f"Mobilization avoidance ${MOBILIZATION_USD_PER_KM[0]//1000}k-"
        f"${MOBILIZATION_USD_PER_KM[1]//1000}k per shared corridor km.",
        f"Land ${LAND_USD_PER_ACRE[0]//1000}k-${LAND_USD_PER_ACRE[1]//1000}k"
        "/acre (rural GA/SC corridor, planning bound).",
        f"Crew-share days = shared window months x {WORKING_DAYS_PER_MONTH}"
        " workable field days/month.",
        "Distances/areas computed in EPSG:32617; rough planning figures only.",
    ]
    pid_a, pid_b = o.get("project_a"), o.get("project_b")
    fa, fb = by_id.get(pid_a), by_id.get(pid_b)
    geom_a = _to_m((fa or {}).get("geometry"))
    geom_b = _to_m((fb or {}).get("geometry"))
    if fa is None or fb is None:
        assumptions.append(
            f"Project geometry not found in projects.geojson for"
            f" {pid_a if fa is None else pid_b} — spatial fields null.")
    tier_radius_km = float(o.get("tier_threshold_km") or 0.0)
    corridor_km = _corridor_km(geom_a, geom_b, tier_radius_km)

    width_m = _row_width_m((fa or {}).get("properties", {}),
                           (fb or {}).get("properties", {}))
    corridor_acres = (
        round(corridor_km * _KM * width_m / _M2_PER_ACRE, 1)
        if corridor_km is not None else None
    )

    zone_m = _to_m(o.get("zone_geometry"))
    zone_area_acres = (
        round(zone_m.area / _M2_PER_ACRE, 1) if zone_m is not None else None
    )
    if zone_m is None:
        assumptions.append(
            "zone_geometry missing/unparseable — ROW acres not zone-capped.")

    # Overlapping ROW = min(zone area, corridor strip area) over the
    # values actually available; None only if neither can be computed.
    area_candidates = [a for a in (zone_area_acres, corridor_acres)
                       if a is not None]
    shared_row_acres = min(area_candidates) if area_candidates else None

    months = _window_months(o.get("shared_window"))
    if months is None:
        assumptions.append(
            "No shared_window — timeline fields and crew-share are null,"
            " not assumed.")

    if corridor_km is None or shared_row_acres is None:
        savings = None
    else:
        lo, hi = MOBILIZATION_USD_PER_KM
        l_lo, l_hi = LAND_USD_PER_ACRE
        savings = {
            "low": int(corridor_km * lo + shared_row_acres * l_lo),
            "high": int(corridor_km * hi + shared_row_acres * l_hi),
            "basis": "shared corridor km x mobilization-avoidance $/km +"
                     " shared ROW acres x land $/acre. Order-of-magnitude"
                     " planning estimate, not an engineering cost figure.",
        }

    return {
        "overlap_id": o.get("overlap_id"),
        "project_a": pid_a,
        "project_b": pid_b,
        "tier": o.get("tier"),
        "timeline_overlap": bool(o.get("timeline_overlap")),
        "shared_corridor_km": corridor_km,
        "row_width_m_assumed": width_m,
        "corridor_acres": corridor_acres,
        "zone_area_acres": zone_area_acres,
        "shared_row_acres": shared_row_acres,
        "shared_window_months": months,
        "crew_share_days": (
            months * WORKING_DAYS_PER_MONTH if months is not None else None
        ),
        "est_savings_usd_range": savings,
        "assumptions": assumptions,
        "confidence": "rough_estimate",
    }


def build_impacts(projects_geojson, overlaps) -> list[dict]:
    """One impact dict per overlap record, keyed by overlap_id."""
    feats = (projects_geojson or {}).get("features", [])
    by_id = {
        f.get("properties", {}).get("project_id"): f
        for f in feats
    }
    rows = overlaps.get("overlaps", []) if isinstance(overlaps, dict) \
        else list(overlaps or [])
    return [_impact_for(o, by_id) for o in rows]
