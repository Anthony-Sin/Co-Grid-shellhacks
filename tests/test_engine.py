"""Unit tests for the overlap engine — synthetic in-code fixtures only
(these test LOGIC, never rendered as data; AGENTS.md §7 unaffected)."""
from __future__ import annotations

import geopandas as gpd
import pytest
from shapely.geometry import LineString, Point

from src.spatial.engine import find_overlaps, load_projects  # noqa: F401
from src.spatial.tiers import TOUCHING_EPS_KM, classify_tier
from src.spatial.timeline import windows_overlap


def _gdf():
    # EPSG:32617-ish coordinates — use real UTM numbers near Savannah
    # (~E 490000, N 3540000). Rows: two lines 2 km apart (tier 3),
    # a substation touching line A (tier 1), one far-away line (>40 km).
    rows = [
        dict(project_id="A", utility="GPC", name="a", kind="transmission_line",
             start_year=2026, end_year=2029,
             geometry=LineString([(490000, 3540000), (495000, 3540000)])),
        dict(project_id="B", utility="DESC", name="b", kind="transmission_line",
             start_year=2027, end_year=2030,
             geometry=LineString([(490000, 3542000), (495000, 3542000)])),
        dict(project_id="C", utility="DESC", name="c", kind="substation",
             start_year=2028, end_year=2028,
             geometry=Point(492500, 3540000)),
        dict(project_id="D", utility="DESC", name="d", kind="transmission_line",
             start_year=2026, end_year=2029,
             geometry=LineString([(550000, 3540000), (555000, 3540000)])),
        dict(project_id="E", utility="DESC", name="e", kind="substation",
             start_year=2028, end_year=2028,
             geometry=Point(492501, 3540001)),  # same utility as C, touching C
    ]
    return gpd.GeoDataFrame(rows, crs="EPSG:32617")


def test_tiers():
    assert classify_tier(0.0) == 1
    assert classify_tier(0.02) == 1
    assert classify_tier(1.0) == 2
    assert classify_tier(1.6) == 3
    assert classify_tier(7.99) == 3
    assert classify_tier(8.0) == 4
    assert classify_tier(39.9) == 4
    assert classify_tier(40.0) is None
    assert TOUCHING_EPS_KM > 0


def test_timeline():
    # kind-aware API: "intersect" (shared window) vs "adjacent" (the GAP
    # between windows — a roll-over, never an overlap) vs None.
    kind, win = windows_overlap(2026, 2029, 2028, 2031)
    assert kind == "intersect" and win == {"start": 2028, "end": 2029}
    kind, win = windows_overlap(2026, 2027, 2030, 2031)
    assert kind is None and win is None
    kind, win = windows_overlap(2026, 2027, 2028, 2031)   # adjacency slack
    assert kind == "adjacent" and win == {"start": 2027, "end": 2028}
    kind, win = windows_overlap(None, None, 2028, 2031)  # unknown → honest no
    assert kind is None and win is None
    kind, win = windows_overlap(2026, 2030, 2028, 2032)
    assert kind == "intersect" and win == {"start": 2028, "end": 2030}
    # adjacent must never be reported as a shared/intersection window
    kind, win = windows_overlap(2027, 2028, 2025, 2026)
    assert kind == "adjacent" and win == {"start": 2026, "end": 2027}


def test_find_overlaps_nan_zones():
    # a row whose zones is NaN (float) must not crash set() — regression:
    # NaN is truthy so `set(z or [])` raised TypeError before the guard.
    gdf = _gdf()
    gdf["zones"] = [["savannah"]] * 3 + [float("nan")] * 2
    recs = find_overlaps(gdf)
    assert {r.project_a for r in recs} | {r.project_b for r in recs}


def test_find_overlaps_cross_utility_only():
    recs = find_overlaps(_gdf())
    pairs = {(r.project_a, r.project_b) for r in recs}
    # A-B are 2 km apart (tier 3); A-C touch (tier 1); A-D >40km gone.
    # A-E & B-E & C-E never appear (same utility / utility pairs deduped).
    assert ("A", "B") in pairs
    assert ("A", "C") in pairs
    assert all("D" not in p for p in pairs)
    # E is DESC — same utility as C (touching) and B: must never pair with
    # another DESC project; every record must span two utilities.
    assert ("C", "E") not in pairs and ("E", "C") not in pairs
    assert all(len(r.utilities) == 2 for r in recs)
    by_pair = {(r.project_a, r.project_b): r for r in recs}
    assert by_pair[("A", "B")].tier == 3
    assert by_pair[("A", "C")].tier == 1
    assert by_pair[("A", "B")].timeline_overlap is True
