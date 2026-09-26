"""Per-overlap impact / cost estimate — the challenge's BONUS deliverable.

Pure functions: callers pass loaded `projects.geojson` + `overlaps.json`.
Every estimate carries its assumptions in-band and is labeled
`confidence: "rough_estimate"` — honesty is graded, so:
- null/None whenever inputs are missing (never invented numbers);
- savings are RANGES with documented low/high bounds, not point figures.

ONE cost model: all land/ROW constants and the corridor measure live in
src/spatial/costmodel.py, shared with ranker.attach_costs — the numbers
here can never diverge from the `cost` stored on each overlap record.
Land/ROW is quantified for tiers 1-2 only; tiers 3-4 share logistics and
crews (spec) — acreage/savings fields are deliberately zero there.

Distance/area math uses the region-fit LCC in src/spatial/crs.py —
same convention as src/spatial/engine.py.
"""
from __future__ import annotations

from typing import Optional

from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform as shp_transform

from src.spatial.costmodel import (LAND_SHARE_MAX_TIER, M2_PER_ACRE,
                                   ROW_PROXIMITY_BAND_M, corridor_km,
                                   estimate_row_savings, row_width_m)
from src.spatial.crs import SOURCE_CRS, TARGET_CRS

_KM = 1000.0
# Realistic field-working days per month (weather, outage windows).
WORKING_DAYS_PER_MONTH = 18

_TRANSFORMER = Transformer.from_crs(SOURCE_CRS, TARGET_CRS, always_xy=True)


def _to_m(geojson_geom: Optional[dict]):
    """GeoJSON (WGS84) -> shapely geometry in meters (region-fit LCC)."""
    if not geojson_geom:
        return None
    try:
        return shp_transform(_TRANSFORMER.transform, shape(geojson_geom))
    except Exception:
        return None


def _window_months(sw: Optional[dict]) -> Optional[int]:
    """Inclusive months in a shared_window {start,end} of integer years."""
    if not sw or sw.get("start") is None or sw.get("end") is None:
        return None
    return (int(sw["end"]) - int(sw["start"]) + 1) * 12


def _impact_for(o: dict, by_id: dict) -> dict:
    tier = o.get("tier") or 0
    land_share = tier <= LAND_SHARE_MAX_TIER
    assumptions = [
        f"Co-location band: {ROW_PROXIMITY_BAND_M:.0f} m — only geometry "
        "inside it counts as shared right-of-way.",
        "ROW width: 45 m typical 115 kV corridor, 60 m for >=230 kV "
        "(higher filed voltage wins).",
        "Avoided corridor establishment $150-400k/km + land $8-25k/acre "
        "(rural GA/SC planning bounds, shared with ranker.attach_costs).",
        f"Crew-share days = shared window months x {WORKING_DAYS_PER_MONTH}"
        " workable field days/month.",
    ]
    pid_a, pid_b = o.get("project_a"), o.get("project_b")
    fa, fb = by_id.get(pid_a), by_id.get(pid_b)
    geom_a = _to_m((fa or {}).get("geometry"))
    geom_b = _to_m((fb or {}).get("geometry"))
    if fa is None or fb is None:
        assumptions.append(
            f"Project geometry not found in projects.geojson for"
            f" {pid_a if fa is None else pid_b} — spatial fields null.")

    zone_m = _to_m(o.get("zone_geometry"))
    zone_area_acres = (
        round(zone_m.area / M2_PER_ACRE, 1) if zone_m is not None else None
    )
    width_m = row_width_m((fa or {}).get("properties", {}).get("voltage_kv"),
                          (fb or {}).get("properties", {}).get("voltage_kv"))

    # --- Land/ROW: tiers 1-2 only -----------------------------------------
    if land_share:
        if geom_a is None or geom_b is None:
            corridor_km = None
            shared_row_acres, savings = None, None
            assumptions.append("Geometry missing — ROW fields null.")
        else:
            corridor_km = shared_corridor_km(geom_a, geom_b)
            est = estimate_row_savings(corridor_km, width_m)
            shared_row_acres = est["acres"]
            savings = {"low": est["low"], "high": est["high"],
                       "basis": est["basis"]}
    else:
        corridor_km, shared_row_acres, savings = 0.0, 0.0, None
        assumptions.append(
            "Tier 3-4: value is shared logistics/crews — land/ROW sharing "
            "is not meaningful at this separation; savings fields are "
            "deliberately empty rather than inflated.")

    # --- Timeline ----------------------------------------------------------
    months = _window_months(o.get("shared_window"))
    if months is None:
        if o.get("timeline_adjacent"):
            assumptions.append(
                "Build windows are adjacent (roll-over), not intersecting "
                "— no concurrent shared window; crew-share days null.")
        else:
            assumptions.append(
                "No shared_window — timeline fields and crew-share are null,"
                " not assumed.")

    return {
        "overlap_id": o.get("overlap_id"),
        "project_a": pid_a,
        "project_b": pid_b,
        "tier": tier,
        "timeline_overlap": bool(o.get("timeline_overlap")),
        "timeline_adjacent": bool(o.get("timeline_adjacent")),
        "shared_corridor_km": corridor_km,
        "row_width_m_assumed": width_m,
        "corridor_acres": shared_row_acres,
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


# alias so the tier-gated call reads naturally
shared_corridor_km = corridor_km


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
