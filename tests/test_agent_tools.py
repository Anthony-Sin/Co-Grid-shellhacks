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

    def test_staging_clusters_covers_all_records(self):
        r = run_tool("staging_clusters", {})
        assert r["ok"]
        res = r["result"]
        assert res["cluster_count"] >= 1
        assert res["overlaps_clustered"] == res["overlaps_total"]
        for c in res["clusters"]:
            assert c["size"] >= 1 and c["overlap_ids"]

    def test_glossary(self):
        r = run_tool("define", {"term": "sertp"})
        assert r["ok"]
        assert "Southeastern Regional Transmission Planning" in r["result"]["definition"]
        r = run_tool("define", {"term": "bogus term xyz"})
        assert "error" in r["result"] or "error" in r

    def test_playbook_returns_seasons(self):
        r = run_tool("playbook", {})
        assert r["ok"], r.get("error")
        res = r["result"]
        assert res["clusters"], res
        top = res["clusters"][0]
        assert top["seasons"] and top["peak_concurrent_sites"] >= 1

    def test_projects_near_finds_okatie_cluster(self):
        # Okatie/McIntosh area — the densest real cluster in the corridor.
        r = run_tool("projects_near", {"lon": -81.06, "lat": 32.34, "km": 15})
        assert r["ok"]
        assert r["result"]["count"] > 0
        for p in r["result"]["projects"]:
            assert p["distance_km"] <= 15

    def test_utility_matrix_pairs(self):
        r = run_tool("utility_matrix", {})
        assert r["ok"], r.get("error")
        res = r["result"]
        assert res["pair_count"] >= 3 and res["pairs"]
        top = res["pairs"][0]
        # statewide data: GPC x GTC dominates (Atlanta metro density) —
        # assert the shape, not a specific pair, so the test survives
        # seed growth.
        assert len(top["utilities"]) == 2
        assert top["overlaps"] > 100
        assert sum(top["by_tier"].values()) == top["overlaps"]
        # DESC x GPC remains a major corridor pair — must appear
        assert any(set(p["utilities"]) == {"DESC", "GPC"} for p in res["pairs"])

    def test_gazetteer_multiword_queries(self):
        # regression: 'Plant Vogtle' used to return 0 while 'Vogtle' hit 5 —
        # the query must be normalized like the index's `norm` field.
        one = run_tool("gazetteer", {"name": "Vogtle"})["result"]
        multi = run_tool("gazetteer", {"name": "Plant Vogtle"})["result"]
        assert one["count"] > 0
        assert multi["count"] > 0
        assert any("VOGTLE" in m["name"].upper() for m in multi["matches"])
        # punctuation/case variation still resolves
        dotted = run_tool("gazetteer", {"name": "vogtle"})["result"]
        assert dotted["count"] == one["count"]
        # unknown stays an honest empty, never fabricated
        miss = run_tool("gazetteer", {"name": "qxz blorf"})["result"]
        assert miss["count"] == 0 and miss["matches"] == []

    def test_projects_near_midsegment_distance(self, monkeypatch):
        # regression: distance must be to the GEOMETRY, not its vertices —
        # a point mid-segment of a straight line used to be missed.
        from src.agent import tool_data
        fake = [{
            "type": "Feature",
            "properties": {"project_id": "P1", "utility": "GPC", "name": "seg"},
            "geometry": {"type": "LineString",
                         "coordinates": [[-81.1, 32.3], [-81.0, 32.3]]},
        }]
        monkeypatch.setattr(tool_data, "projects", lambda: fake)
        # 0.6 km north of the segment's midpoint — vertices are ~4.7 km away
        r = tool_data.tool_projects_near(-81.05, 32.305, km=1.0)
        assert r["count"] == 1
        assert r["projects"][0]["distance_km"] < 1.0
        # far from the whole segment -> honest miss
        r = tool_data.tool_projects_near(-81.05, 32.6, km=1.0)
        assert r["count"] == 0

    def test_run_brief_unknown_overlap_no_500(self):
        # regression: /api/agent/brief used to KeyError->500 because
        # run_brief checked the wrapper, not result.error.
        from src.agent.client import AgentConfig
        from src.agent.engine import run_brief
        cfg = AgentConfig(api_key="x", base_url="x", model="x")
        out = run_brief(cfg, "OV-NOPE-999")
        assert "error" in out and "OV-NOPE-999" in out["error"]

    def test_client_nonjson_200_raises_chaterror(self):
        # regression: a non-JSON 200 body crashed with JSONDecodeError
        # instead of a controlled ChatError (route -> 502, not 500).
        import requests  # noqa: F401
        from src.agent import client as client_mod
        from src.agent.client import AgentConfig, ChatError

        class _Resp:
            status_code = 200
            text = "<html>bad gateway page</html>"
            def json(self):
                raise ValueError("No JSON object could be decoded")

        monkey = pytest.MonkeyPatch()
        monkey.setattr(client_mod.requests, "post", lambda *a, **k: _Resp())
        try:
            cfg = AgentConfig(api_key="x", base_url="http://x", model="x")
            with pytest.raises(ChatError):
                client_mod.chat_completion(cfg, [{"role": "user", "content": "hi"}])
        finally:
            monkey.undo()
