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

    def test_get_overlap_batch_mode(self):
        # multi-record questions shouldn't burn a tool round per lookup —
        # one call returns found records + honest missing ids.
        ids = [o["overlap_id"] for o in
               run_tool("top_overlaps", {"n": 3})["result"]["overlaps"]]
        r = run_tool("get_overlap", {"overlap_ids": ids + ["OV-NOPE-1"]})
        assert r["ok"]
        res = r["result"]
        assert res["found"] == 3 and res["missing"] == ["OV-NOPE-1"]
        assert {o["overlap_id"] for o in res["overlaps"]} == set(ids)
        # a comma-joined string is coerced (models emit those); empties error
        r = run_tool("get_overlap", {"overlap_ids": f"{ids[0]}, {ids[1]}"})
        assert r["result"]["found"] == 2
        assert "error" in run_tool("get_overlap", {"overlap_ids": []})["result"]
        assert "error" in run_tool("get_overlap", {})["result"]

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

    def test_find_overlaps_filters(self):
        r = run_tool("find_overlaps", {"utility": "DESC", "tier": 1,
                                       "timeline_only": True})
        res = r["result"]
        assert res["total_matching"] > 0
        for o in res["overlaps"]:
            assert "DESC" in o["utilities"] and o["tier"] == 1
            assert o["timeline_overlap"] is True
        # exact-pair restriction: only records between the two utilities
        r = run_tool("find_overlaps", {"utilities": "DESC,GPC", "limit": 5})
        for o in r["result"]["overlaps"]:
            assert sorted(o["utilities"]) == ["DESC", "GPC"]
        # honest empty on a nonsense zone
        r = run_tool("find_overlaps", {"zone": "__nowhere__"})
        assert r["result"]["total_matching"] == 0
        # adjacent_only returns only end-to-start handoff records —
        # a different class, never intersecting
        r = run_tool("find_overlaps", {"adjacent_only": True, "limit": 50})
        res = r["result"]
        assert res["total_matching"] > 0
        for o in res["overlaps"]:
            assert o["timeline_adjacent"] and not o["timeline_overlap"]
        # the two flags are exclusive
        assert "error" in run_tool(
            "find_overlaps", {"timeline_only": True,
                              "adjacent_only": True})["result"]

    def test_project_overlaps_portfolio(self):
        # OV-0001's project_a must own at least that record
        top = run_tool("top_overlaps", {"n": 1})["result"]["overlaps"][0]
        r = run_tool("project_overlaps", {"project_id": top["project_a"]})
        res = r["result"]
        assert res["overlap_count"] >= 1
        rec = res["overlaps"][0]
        assert rec["against"] != top["project_a"]
        assert rec["overlap_id"] == top["overlap_id"]
        # unknown project -> honest zero, not a crash
        r = run_tool("project_overlaps", {"project_id": "NOPE-1"})
        assert r["result"]["overlap_count"] == 0

    def test_compare_overlaps_deltas(self):
        ids = [o["overlap_id"] for o in
               run_tool("top_overlaps", {"n": 3})["result"]["overlaps"]]
        r = run_tool("compare_overlaps", {"overlap_ids": ids})
        res = r["result"]
        assert len(res["records"]) == 3 and res["missing"] == []
        assert res["closest"] in ids and res["highest_scored"] in ids
        # too few / too many ids -> error
        assert "error" in run_tool(
            "compare_overlaps", {"overlap_ids": [ids[0]]})["result"]
        assert "error" in run_tool(
            "compare_overlaps", {"overlap_ids": ids * 4})["result"]

    def test_why_ranked_decomposition_matches_score(self):
        top = run_tool("top_overlaps", {"n": 1})["result"]["overlaps"][0]
        r = run_tool("why_ranked", {"overlap_id": top["overlap_id"]})
        res = r["result"]
        c = res["components"]
        # the decomposition must reproduce the stored score exactly
        total = (c["tier_base"] + c["distance_within_tier"]
                 + c["timeline_intersect_bonus"] + c["voltage_bonus"])
        assert abs(total - res["ranked_score"]) < 0.15  # rounding to .1
        # rank = position in the stored tuple-sorted corpus; ids are
        # renumbered after that sort so OV-NNNN <=> position N
        assert res["rank_position"] == int(top["overlap_id"].split("-")[1])
        assert res["of_records"] > 1000

    def test_zone_report_real_tag(self):
        r = run_tool("zone_report", {"zone": "savannah"})
        res = r["result"]
        assert res["projects"] > 0 and res["overlaps"] > 0
        assert sum(res["tiers"].values()) == res["overlaps"]
        assert res["dominant_pair"]
        assert "error" in run_tool("zone_report", {"zone": "__nope__"})["result"]

    def test_savings_rollup_sums_stored_costs(self):
        r = run_tool("savings_rollup", {"tier_max": 2})
        res = r["result"]
        assert res["priced_records"] > 0
        assert res["total_est_savings_usd_high"] >= res["total_est_savings_usd_low"] > 0
        # utility filter narrows scope
        r2 = run_tool("savings_rollup", {"utility": "DESC", "tier_max": 2})
        assert r2["result"]["records_in_scope"] <= res["records_in_scope"]

    def test_what_if_shift_hypothetical(self):
        top = run_tool("top_overlaps", {"n": 1})["result"]["overlaps"][0]
        pid = top["project_a"]
        # shifting far into the future must lose every relationship
        r = run_tool("what_if_shift", {"project_id": pid,
                                       "new_start": 2050, "new_end": 2051})
        res = r["result"]
        assert res["hypothetical"] is True
        assert res["records_evaluated"] >= 1
        assert res["lost_relationship"] >= 0
        for rec in res["per_record"]:
            assert rec["would_be"] == "none"
        # bad args
        assert "error" in run_tool(
            "what_if_shift", {"project_id": pid, "new_start": 2030,
                              "new_end": 2020})["result"]
        assert "error" in run_tool(
            "what_if_shift", {"project_id": "NOPE", "new_start": 2030,
                              "new_end": 2031})["result"]

    def test_season_calendar_both_modes(self):
        from src.agent.tool_data import overlaps
        r = run_tool("season_calendar", {})
        res = r["result"]
        assert res["by_start_year"]  # at least one schedulable season
        # whole-calendar counts sum to the true window-intersecting set
        total = sum(res["by_start_year"].values())
        real = {o["overlap_id"] for o in overlaps() if o.get("timeline_overlap")}
        assert total == len(real)
        # per-year mode returns the actual records — every one a genuine
        # window intersection, never an adjacent-only record
        y = int(next(iter(res["by_start_year"])))
        r = run_tool("season_calendar", {"year": y})
        res = r["result"]
        assert res["schedulable_records"] > 0
        assert all(o["window"]["start"] == y for o in res["overlaps"])
        assert all(o["overlap_id"] in real for o in res["overlaps"])

    def test_no_overlap_reason_diagnosis(self):
        from src.agent.tool_data import overlaps, projects
        in_any = {o["project_a"] for o in overlaps()} | \
                 {o["project_b"] for o in overlaps()}
        lonely = next(f["properties"]["project_id"] for f in projects()
                      if f["properties"]["project_id"] not in in_any)
        r = run_tool("no_overlap_reason", {"project_id": lonely})["result"]
        assert r["overlap_records"] == 0
        # the diagnosis must name a real nearest cross-utility project
        # beyond 40 km — the honest 'why not'
        nc = r["nearest_cross_utility"]
        assert nc and nc["distance_km"] > 40.0
        assert "outside the" in r["reason"]
        # a project WITH records gets a redirect, not a fake diagnosis
        pid = next(iter(in_any))
        r = run_tool("no_overlap_reason", {"project_id": pid})["result"]
        assert r["overlap_records"] >= 1
        assert "error" in run_tool(
            "no_overlap_reason", {"project_id": "NOPE"})["result"]

    def test_handoff_chains_directed_and_real(self):
        from src.agent.tool_data import overlaps, projects
        wins = {f["properties"]["project_id"]:
                (f["properties"].get("start_year"),
                 f["properties"].get("end_year")) for f in projects()}
        adjacent_ids = {o["overlap_id"] for o in overlaps()
                        if o.get("timeline_adjacent")
                        and not o.get("timeline_overlap")}
        r = run_tool("handoff_chains", {})["result"]
        assert r["chains_found"] > 0
        for c in r["chains"]:
            assert c["length_hops"] == len(c["projects"]) - 1
            assert len(set(c["projects"])) == len(c["projects"])
            # every hop is a real adjacent record
            for h in c["hops"]:
                assert h["overlap_id"] in adjacent_ids
            # direction: each project ends <= next starts (crew relay
            # is time-ordered, not symmetric)
            for x, y in zip(c["projects"], c["projects"][1:]):
                wx, wy = wins[x], wins[y]
                if wx[1] is not None and wy[0] is not None:
                    assert wx[1] <= wy[0], (x, wx, y, wy)

    def test_voltage_match_equipment_classes(self):
        from src.agent.tool_data import overlaps, projects
        projs = {f["properties"]["project_id"]: f["properties"]
                 for f in projects()}
        r = run_tool("voltage_match", {})["result"]
        assert r["same_voltage_records"] + r["interface_records"] == \
            len(overlaps())
        # every 'same' entry genuinely equal-kV on both sides
        for e in r["top_same_voltage"]:
            pa, pb = e.get("kv_a"), e.get("kv_b")
            assert pa == pb and pa is not None
        for e in r["top_interface"]:
            assert e["kv_a"] != e["kv_b"] or e["kv_a"] is None
        # tier filter narrows scope
        r2 = run_tool("voltage_match", {"tier": 1})["result"]
        assert r2["same_voltage_records"] + r2["interface_records"] <= \
            len(overlaps())

    def test_utility_profile_rollup(self):
        from src.agent.tool_data import overlaps, projects
        r = run_tool("utility_profile", {"utility": "MEAG"})["result"]
        assert r["projects"] > 0 and r["overlap_records"] > 0
        real = [o for o in overlaps() if "MEAG" in (o.get("utilities") or [])]
        assert r["overlap_records"] == len(real)
        assert sum(r["tiers"].values()) == len(real)
        # partners cover every MEAG record's other side
        meag_partners = {x for o in real for x in o["utilities"] if x != "MEAG"}
        assert set(r["partners"]) == meag_partners
        assert sum(r["location_confidence"].values()) == r["projects"]
        assert "error" in run_tool(
            "utility_profile", {"utility": "FAKECO"})["result"]

    def test_what_if_drop_utility_partner_exit(self):
        from src.agent.tool_data import overlaps
        allr = overlaps()
        r = run_tool("what_if_drop_utility", {"utility": "DESC"})["result"]
        assert r["hypothetical"] is True
        real_dead = [o for o in allr if "DESC" in (o.get("utilities") or [])]
        assert r["records_lost"] == len(real_dead)
        assert sum(r["lost_by_tier"].values()) == len(real_dead)
        # every reported partner genuinely co-occurs on a dead record
        desc_partners = {x for o in real_dead for x in o["utilities"]
                         if x != "DESC"}
        assert {p["utility"] for p in r["partners_most_affected"]} == \
            desc_partners
        assert "error" in run_tool(
            "what_if_drop_utility", {"utility": "FAKECO"})["result"]

    def test_overlap_neighbors_matches_route(self):
        from src.analysis.nearby import build_nearby
        from src.agent.tool_data import overlaps
        top = run_tool("top_overlaps", {"n": 1})["result"]["overlaps"][0]
        oid = top["overlap_id"]
        tool = run_tool("overlap_neighbors", {"overlap_id": oid})["result"]
        route = build_nearby(overlaps(), oid, 40.0)
        assert tool["neighbor_count"] == route["neighbor_count"]
        assert [n["overlap_id"] for n in tool["neighbors"]] == \
               [n["overlap_id"] for n in route["neighbors"]]
        # every neighbor genuinely within the default radius
        assert all(n["distance_km"] <= 40.0 for n in tool["neighbors"])
        assert "error" in run_tool(
            "overlap_neighbors", {"overlap_id": "NOPE"})["result"]

    def test_get_overlap_detail_has_deep_link(self):
        top = run_tool("top_overlaps", {"n": 1})["result"]["overlaps"][0]
        d = run_tool("get_overlap", {"overlap_id": top["overlap_id"]})["result"]
        assert d["deep_link"].startswith("/?scene=")
        assert f"select={top['overlap_id']}" in d["deep_link"]
        # members resolve id -> name/utility/source so one call cites fully
        assert len(d["members"]) == 2
        for m in d["members"]:
            assert m["project_id"] and m["utility"] and m["name"]
            assert m["source"]

    def test_list_projects_source_filter(self):
        # provenance queries: a filing-name substring selects that
        # source family and every returned project carries the match.
        r = run_tool("list_projects", {"source": "sertp", "limit": 50})
        assert r["ok"]
        res = r["result"]
        assert res["count"] > 100
        assert res["shown"] == 50
        for p in res["projects"]:
            assert "sertp" in p["source"].lower()
        # unfiltered count is strictly larger
        total = run_tool("list_projects", {})["result"]["count"]
        assert res["count"] < total

    def test_map_focus_validates_and_builds_ui_action(self):
        # the map-driving tool validates ids against the loaded artifacts
        # and returns the ui_action the frontend applies — never a
        # fabricated target.
        top = run_tool("top_overlaps", {"n": 1})["result"]["overlaps"][0]
        res = run_tool("map_focus", {"overlap_id": top["overlap_id"]})["result"]
        assert res["ok"] is True
        assert res["ui_action"]["select_overlap"] == top["overlap_id"]

        pid = top["project_a"]
        res = run_tool("map_focus", {"project_id": pid})["result"]
        assert res["ok"] and res["ui_action"]["select_project"] == pid

        # utility resolves case-insensitively to the canonical tag
        res = run_tool("map_focus", {"utility": "desc"})["result"]
        assert res["ok"] and res["ui_action"]["utility_filter"] == ["DESC"]

        # tiers coerce from a list / string; clear alone is a valid action
        res = run_tool("map_focus", {"tiers": [2, 1]})["result"]
        assert res["ok"] and res["ui_action"]["tiers"] == [1, 2]
        res = run_tool("map_focus", {"tiers": "1,3"})["result"]
        assert res["ui_action"]["tiers"] == [1, 3]
        res = run_tool("map_focus", {"clear": True})["result"]
        assert res["ok"] and res["ui_action"]["clear"] is True

        # honest errors — unknown ids, out-of-range tiers, empty call
        for bad in ({"overlap_id": "OV-NOPE"}, {"project_id": "NOPE"},
                    {"utility": "FAKECO"}, {"tiers": [0, 9]}, {}):
            res = run_tool("map_focus", bad)["result"]
            assert res["ok"] is False and "error" in res, bad
            assert "ui_action" not in res

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
