"""Agent tool-layer tests — real processed artifacts, no network needed."""
import json
from pathlib import Path

import pytest

from src.agent.tools import run_tool, TOOLS, openai_tool_specs

PROCESSED = Path(__file__).resolve().parents[1] / "data" / "processed"


@pytest.mark.skipif(
    not (PROCESSED / "projects.geojson").exists(),
    reason="pipeline artifacts not generated yet",
)
class TestToolsAgainstRealData:
    def test_stats_shape(self):
        r = run_tool("stats", {})
        assert r["ok"]
        res = r["result"]
        assert res["projects"] > 0
        assert sum(res["by_utility"].values()) == res["projects"]
        assert res["overlaps"] > 0

    def test_top_overlaps_sorted_and_bounded(self):
        r = run_tool("top_overlaps", {"n": 5})
        ovs = r["result"]["overlaps"]
        assert len(ovs) == 5
        scores = [o["score"] for o in ovs]
        assert scores == sorted(scores, reverse=True)
        for o in ovs:
            assert o["overlap_id"].startswith("OV-")
            assert o["utilities"] and len(o["utilities"]) == 2

    def test_get_overlap_roundtrip(self):
        top = run_tool("top_overlaps", {"n": 1})["result"]["overlaps"][0]
        detail = run_tool("get_overlap", {"overlap_id": top["overlap_id"]})
        assert detail["ok"]
        assert detail["result"]["overlap_id"] == top["overlap_id"]
        assert detail["result"]["midpoint"]

    def test_unknown_and_bad_args_are_data_not_crashes(self):
        assert "error" in run_tool("nonexistent_tool", {})
        # domain-level "not found" rides inside result.error
        r = run_tool("get_overlap", {"overlap_id": "OV-XXXX-NOPE"})
        assert "error" in r["result"]
        # unexpected kwargs -> TypeError surfaces as top-level error
        r = run_tool("get_overlap", {"unexpected_kwarg": 1})
        assert "error" in r

    def test_tool_specs_cover_registry(self):
        specs = openai_tool_specs()
        assert len(specs) == len(TOOLS)
        for s in specs:
            f = s["function"]
            assert f["name"] in TOOLS
            assert f["parameters"]["type"] == "object"

    def test_projects_near_finds_okatie_cluster(self):
        # Okatie/McIntosh area — the densest real cluster in the corridor.
        r = run_tool("projects_near", {"lon": -81.06, "lat": 32.34, "km": 15})
        assert r["ok"]
        assert r["result"]["count"] > 0
        for p in r["result"]["projects"]:
            assert p["distance_km"] <= 15
