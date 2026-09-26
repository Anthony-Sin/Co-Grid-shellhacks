"""Unit tests for src/analysis — small synthetic in-code fixtures only
(these test LOGIC, never rendered as data; AGENTS.md §7 unaffected)."""
from __future__ import annotations

import json

from shapely.geometry import LineString, Polygon, mapping

from src.analysis.impact import WORKING_DAYS_PER_MONTH, build_impacts
from src.analysis.timeline import build_timeline, windows, yearly_band


def _feat(pid, util, start, end, geom=None, kv=115):
    return {
        "type": "Feature",
        "properties": {
            "project_id": pid, "utility": util, "name": pid,
            "kind": "transmission_line", "voltage_kv": kv,
            "start_year": start, "end_year": end,
        },
        "geometry": mapping(geom) if geom is not None else None,
    }


def _ov(oid, a, b, sw, tier=3):
    return {
        "overlap_id": oid, "project_a": a, "project_b": b,
        "utilities": ["GPC", "DESC"], "min_distance_km": 2.0,
        "tier": tier, "tier_threshold_km": {1: .03, 2: 1.6, 3: 8., 4: 40.}[tier],
        "timeline_overlap": sw is not None, "shared_window": sw,
        "zone_geometry": None,
    }


# --- timeline: yearly band ----------------------------------------------------

def test_yearly_band_counts_and_skips():
    feats = [
        _feat("A", "GPC", 2026, 2029),
        _feat("B", "DESC", 2027, 2030),
        _feat("C", "DESC", None, 2030),   # missing start -> skipped, honestly
    ]
    ovs = [_ov("OV-1", "A", "B", {"start": 2027, "end": 2029}),
           _ov("OV-2", "A", "C", None)]
    band = yearly_band(feats, ovs)
    assert band["span"] == {"start": 2026, "end": 2030}
    rows = {r["year"]: r for r in band["rows"]}
    assert rows[2026]["total"] == 1 and rows[2026]["by_utility"] == {"GPC": 1}
    assert rows[2028]["total"] == 2 and rows[2028]["overlaps_active"] == 1
    assert rows[2030]["total"] == 1 and rows[2030]["overlaps_active"] == 0
    assert band["projects_skipped_missing_dates"] == 1
    assert band["overlaps_without_window"] == 1
    assert len(band["rows"]) == 5


def test_window_buckets_and_longest():
    ovs = [
        _ov("OV-1", "A", "B", {"start": 2027, "end": 2029}),   # len 2 -> 1-3yr
        _ov("OV-2", "A", "B", {"start": 2028, "end": 2032}),   # len 4 -> >3yr
        _ov("OV-3", "A", "B", {"start": 2026, "end": 2026}),   # 0yr
        _ov("OV-4", "A", "B", None),                            # none
    ]
    w = windows(ovs)
    assert w["buckets"] == {"none_or_0yr": 2, "lt_1yr": 0,
                           "1_to_3yr": 1, "gt_3yr": 1}
    assert w["longest_shared_window"] == {
        "overlap_id": "OV-2", "start": 2028, "end": 2032, "length_years": 4}
    assert w["count"] == 4


def test_quarterly_band_even_span():
    feats = [_feat("A", "GPC", 2026, 2027)]
    ovs = [_ov("OV-1", "A", "B", {"start": 2027, "end": 2027})]
    q = build_timeline({"features": feats}, {"overlaps": ovs})["quarterly"]
    labels = [r["quarter"] for r in q["rows"]]
    assert labels == ["2026Q1", "2026Q2", "2026Q3", "2026Q4",
                      "2027Q1", "2027Q2", "2027Q3", "2027Q4"]
    assert all(r["total"] == 1 for r in q["rows"])
    by_label = {r["quarter"]: r for r in q["rows"]}
    assert by_label["2027Q4"]["overlaps_active"] == 1
    assert by_label["2026Q1"]["overlaps_active"] == 0


# --- impact --------------------------------------------------------------------

def _zone(lon0, lat0, lon1, lat1):
    return mapping(Polygon([(lon0, lat0), (lon1, lat0), (lon1, lat1),
                            (lon0, lat1), (lon0, lat0)]))


def test_impact_shared_corridor_positive():
    # Two parallel ~4.7 km lines ~110 m apart — inside the co-location
    # band, so a tier-2 record gets real shared-ROW numbers.
    a = LineString([(-81.10, 32.30), (-81.05, 32.30)])
    b = LineString([(-81.10, 32.301), (-81.05, 32.301)])
    projects = {"features": [
        _feat("A", "GPC", 2026, 2030, a, kv=230),
        _feat("B", "DESC", 2027, 2032, b, kv=230),
    ]}
    ov = _ov("OV-1", "A", "B", {"start": 2027, "end": 2029}, tier=2)
    ov["zone_geometry"] = _zone(-81.11, 32.29, -81.04, 32.33)
    [imp] = build_impacts(projects, {"overlaps": [ov]})
    assert 4.0 < imp["shared_corridor_km"] < 5.5
    assert imp["row_width_m_assumed"] == 60.0     # 230 kV wins
    assert imp["shared_row_acres"] > 0
    assert imp["shared_window_months"] == 36      # 2027-2029 inclusive
    assert imp["crew_share_days"] == 36 * WORKING_DAYS_PER_MONTH
    s = imp["est_savings_usd_range"]
    assert s["low"] > 0 and s["high"] > s["low"]
    assert imp["confidence"] == "rough_estimate" and imp["assumptions"]
    json.dumps(imp)  # serializable


def test_impact_tier34_no_land_savings():
    # Spec: tiers 3-4 share logistics/crews ONLY — land/ROW fields must be
    # gated to zero, never inflated by the tier radius (regression: a 40 km
    # buffer used to claim hundreds of acres on distant pairs).
    a = LineString([(-81.10, 32.30), (-81.05, 32.30)])
    b = LineString([(-81.10, 32.40), (-81.05, 32.40)])
    projects = {"features": [
        _feat("A", "GPC", 2026, 2030, a, kv=230),
        _feat("B", "DESC", 2027, 2032, b, kv=230),
    ]}
    for tier in (3, 4):
        ov = _ov(f"OV-t{tier}", "A", "B", {"start": 2027, "end": 2029}, tier=tier)
        [imp] = build_impacts(projects, {"overlaps": [ov]})
        assert imp["shared_corridor_km"] == 0.0
        assert imp["shared_row_acres"] == 0.0
        assert imp["est_savings_usd_range"] is None
        assert any("Tier 3-4" in x for x in imp["assumptions"])
        # windows still count honestly — intersecting windows share crews
        assert imp["shared_window_months"] == 36


def test_impact_adjacent_window_no_months():
    # Adjacent (roll-over) windows are not a concurrent shared window —
    # months/crew-share must be null, with the adjacency named in-band.
    a = LineString([(-81.10, 32.30), (-81.05, 32.30)])
    b = LineString([(-81.10, 32.301), (-81.05, 32.301)])
    projects = {"features": [
        _feat("A", "GPC", 2027, 2028, a),
        _feat("B", "DESC", 2025, 2026, b),
    ]}
    ov = _ov("OV-adj", "A", "B", None, tier=2)
    ov["timeline_adjacent"] = True
    ov["adjacent_window"] = {"start": 2026, "end": 2027}
    [imp] = build_impacts(projects, {"overlaps": [ov]})
    assert imp["shared_window_months"] is None
    assert imp["crew_share_days"] is None
    assert imp["timeline_adjacent"] is True
    assert any("adjacent" in x for x in imp["assumptions"])


def test_impact_honesty_missing_inputs():
    # No shared window + one project not in the file -> nulls, never fakes.
    # Tier-2 so the land-share gate is open and geometry-missing is what
    # nulls the ROW fields (not the tier gate).
    projects = {"features": [_feat("A", "GPC", 2026, 2030,
                                   LineString([(-81.1, 32.3), (-81.0, 32.3)]))]}
    ov = _ov("OV-9", "A", "MISSING", None, tier=2)
    [imp] = build_impacts(projects, {"overlaps": [ov]})
    assert imp["shared_corridor_km"] is None
    assert imp["shared_row_acres"] is None
    assert imp["shared_window_months"] is None
    assert imp["crew_share_days"] is None
    assert imp["est_savings_usd_range"] is None
    assert imp["timeline_overlap"] is False
    assert any("not found" in a or "No shared_window" in a
               for a in imp["assumptions"])


def test_build_timeline_shape_serializable():
    feats = [_feat("A", "GPC", 2026, 2029), _feat("B", "DESC", 2027, 2030)]
    ovs = [_ov("OV-1", "A", "B", {"start": 2027, "end": 2029})]
    out = build_timeline({"features": feats}, {"overlaps": ovs})
    assert set(out) >= {"yearly", "quarterly", "windows"}
    json.dumps(out)


# --- staging clusters -----------------------------------------------------------

def _cl_ov(oid, lon, lat):
    """Overlap fixture with a midpoint (clusters consume midpoints only)."""
    ov = _ov(oid, "A", "B", None)
    ov["midpoint"] = [lon, lat]
    return ov


def test_clusters_are_yard_servable_not_chained():
    # Regression: single-linkage chaining used to emit one "cluster"
    # spanning 200+ km and claim one yard could serve it — false under
    # the 40 km rule. The yard-cover must bound every cluster.
    from src.analysis.clusters import build_clusters
    ovs = [
        # a 5-stop chain: each hop ~33 km (<40), endpoints ~132 km apart —
        # single linkage merges all five, but no one yard reaches them all
        _cl_ov("OV-a", -81.00, 32.30),
        _cl_ov("OV-b", -80.65, 32.30),
        _cl_ov("OV-c", -80.30, 32.30),
        _cl_ov("OV-d", -79.95, 32.30),
        _cl_ov("OV-e", -79.60, 32.30),
    ]
    out = build_clusters({"overlaps": ovs}, radius_km=40.0)
    assert out["overlaps_clustered"] == 5
    assert out["corridor_count"] == 1            # still ONE corridor (honest context)
    assert out["cluster_count"] == 2             # but TWO yards needed
    for c in out["clusters"]:
        assert c["max_site_distance_km"] <= 40.0
        assert c["yard_site"]["lon"] is not None
        ids = set(c["overlap_ids"])
        assert len(ids) == c["size"]
    json.dumps(out)


def test_cluster_best_overlap_zero_distance_wins():
    # Regression: `d or 9e9` treated 0.0 km as missing — a touching record
    # must win best_overlap, not lose to a 5 km record in the same disk.
    from src.analysis.clusters import build_clusters
    ovs = [_cl_ov("OV-far", -81.0, 32.3), _cl_ov("OV-touch", -81.001, 32.3)]
    ovs[1]["min_distance_km"] = 0.0
    ovs[0]["min_distance_km"] = 5.0
    [c] = build_clusters({"overlaps": ovs}, radius_km=40.0)["clusters"]
    assert c["best_overlap"] == "OV-touch" and c["best_distance_km"] == 0.0


def test_clusters_empty_and_nomids():
    from src.analysis.clusters import build_clusters
    out = build_clusters({"overlaps": [_ov("OV-1", "A", "B", None)]})
    assert out["cluster_count"] == 0 and out["overlaps_clustered"] == 0
    assert out["clusters"] == []
