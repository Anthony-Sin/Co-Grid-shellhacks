"""HTTP-layer coverage — the deterministic API surface over real artifacts.

Skips cleanly if processed data hasn't been generated yet.
"""
import json
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from src.api.main import app

PROCESSED = Path(__file__).resolve().parents[1] / "data" / "processed"
client = TestClient(app)


@unittest.skipUnless((PROCESSED / "overlaps.json").exists(),
                     "processed artifacts missing — run scripts/pipeline.sh")
class ApiRoutesTest(unittest.TestCase):

    def test_health(self):
        r = client.get("/api/health")
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_projects_and_search(self):
        r = client.get("/api/projects")
        assert r.status_code == 200 and r.json()["features"]

    def test_overlaps_filters(self):
        r = client.get("/api/overlaps", params={"tier": 1, "timeline_only": True})
        assert r.status_code == 200
        rows = r.json()["overlaps"]
        assert all(o["tier"] == 1 and o["timeline_overlap"] for o in rows)
        r = client.get("/api/overlaps", params={"q": "mcintosh"})
        assert r.json()["overlaps"], "mcintosh search must hit real records"

    def test_overlaps_sort_limit_zone(self):
        r = client.get("/api/overlaps", params={"sort": "distance", "limit": 5})
        rows = r.json()["overlaps"]
        assert len(rows) <= 5
        dists = [o["min_distance_km"] for o in rows]
        assert dists == sorted(dists), "distance sort must be ascending"
        r = client.get("/api/overlaps", params={"zone": "charleston"})
        rows = r.json()["overlaps"]
        assert rows and all("charleston" in o["zone"].lower() for o in rows)
        r = client.get("/api/overlaps", params={"sort": "bogus"})
        assert r.status_code == 422

    def test_overlaps_csv(self):
        r = client.get("/api/overlaps.csv", params={"tier": 1})
        assert r.status_code == 200
        assert "overlap_id" in r.text.splitlines()[0]

    def test_analysis_endpoints(self):
        for path in ("/api/analysis/timeline", "/api/analysis/calendar",
                     "/api/analysis/clusters", "/api/analysis/playbook",
                     "/api/analysis/conflicts", "/api/meta",
                     "/api/analysis/matrix", "/api/analysis/nearby/OV-0004"):
            r = client.get(path)
            assert r.status_code == 200, path
            assert r.json(), path
        r = client.get("/api/analysis/impact/OV-0004")
        assert r.status_code == 200
        assert r.json()["overlap_id"] == "OV-0004"

    def test_regions_and_city(self):
        r = client.get("/api/regions")
        assert r.status_code == 200 and r.json()["regions"]
        r = client.get("/api/city/state")
        assert r.status_code == 200
        body = r.json()
        assert body.get("bounds_m") and body.get("pois") is not None

    def test_agent_health_degrades_gracefully(self):
        r = client.get("/api/agent/health")
        assert r.status_code == 200
        body = r.json()
        assert "configured" in body and "tools" in body
        assert len(body["tools"]) >= 10

    def test_raw_path_confined(self):
        r = client.get("/api/raw/../processed/overlaps.json")
        assert r.status_code in (403, 404, 422)
        # absolute-path injection + deeper traversal also can't escape
        r = client.get("/api/raw//etc/passwd")
        assert r.status_code in (403, 404, 422)

    def test_projects_zone_filter_honest(self):
        # regression: a zone-less project used to match EVERY zone filter
        # and zones:null crashed with TypeError.
        r = client.get("/api/projects", params={"zone": "__nonexistent__"})
        assert r.status_code == 200
        assert r.json()["features"] == []
        r = client.get("/api/projects", params={"zone": "savannah"})
        feats = r.json()["features"]
        assert feats
        assert all("savannah" in (f["properties"].get("zones") or [])
                   for f in feats)

    def test_csv_rank_matches_api_order(self):
        # regression: CSV rank used score-desc while the UI uses engine
        # order — two different ranks for the same record. Canonical rank
        # is engine order (what /api/overlaps serves).
        api_rows = client.get("/api/overlaps").json()["overlaps"]
        csv_text = client.get("/api/overlaps.csv").text
        lines = csv_text.strip().splitlines()
        header = lines[0].split(",")
        assert "timeline_adjacent" in header
        csv_ids = [ln.split(",")[1] for ln in lines[1:]]
        assert csv_ids == [o["overlap_id"] for o in api_rows]

    def test_stats_covers_zero_overlap_utilities(self):
        # coverage must list every utility in the project set — including
        # utilities whose projects participate in zero overlaps.
        s = client.get("/api/stats").json()
        assert set(s["coverage"]) == set(s["by_utility"])
        for u, c in s["coverage"].items():
            assert c["in_overlaps"] <= c["projects"]

    def test_conflicts_require_true_intersection(self):
        # regression: tier-1 ADJACENT-only records were counted as mandatory
        # joint outages though the windows never coincide.
        ovs = client.get("/api/overlaps").json()["overlaps"]
        by_id = {o["overlap_id"]: o for o in ovs}
        c = client.get("/api/analysis/conflicts").json()
        for row in c["overlaps"]:
            r = by_id[row["overlap_id"]]
            assert r["tier"] == 1 and r["timeline_overlap"]
            assert r["shared_window"], row["overlap_id"]
        for row in c.get("adjacent_tier1", []):
            r = by_id[row["overlap_id"]]
            assert r["tier"] == 1 and r["timeline_adjacent"]
            assert not r["timeline_overlap"]

    def test_impact_tier34_gated_on_real_record(self):
        # a real tier-4 record must report no land/ROW sharing anywhere.
        ovs = client.get("/api/overlaps", params={"tier": 4}).json()["overlaps"]
        r4 = ovs[0]
        imp = client.get(f"/api/analysis/impact/{r4['overlap_id']}").json()
        assert imp["shared_row_acres"] == 0.0
        assert imp["shared_corridor_km"] == 0.0
        assert imp["est_savings_usd_range"] is None
        assert (r4.get("cost") or {}).get("est_savings_usd_high") == 0

    def test_impact_tier12_matches_stored_cost(self):
        # stored cost and /api/analysis/impact must quote the same model —
        # the reviewer's OV-0001 divergence can never recur.
        ovs = client.get("/api/overlaps").json()["overlaps"]
        t12 = [o for o in ovs if o["tier"] <= 2 and o.get("cost")]
        for r in t12[:8]:
            imp = client.get(f"/api/analysis/impact/{r['overlap_id']}").json()
            cost = r["cost"]
            assert imp["shared_corridor_km"] == cost["shared_row_km"]
            assert imp["shared_row_acres"] == cost["shared_row_acres"]
            rng = imp["est_savings_usd_range"] or {}
            assert rng.get("low") == cost["est_savings_usd_low"]
            assert rng.get("high") == cost["est_savings_usd_high"]

    def test_adjacent_records_serialized(self):
        # records where windows roll end-to-start carry the honest flags.
        ovs = client.get("/api/overlaps").json()["overlaps"]
        adj = [o for o in ovs if o.get("timeline_adjacent")]
        assert adj, "dataset should contain adjacency-only records"
        for r in adj:
            assert r["timeline_overlap"] is False
            assert r["shared_window"] is None
            assert r["adjacent_window"]
