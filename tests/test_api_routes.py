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

    def test_overlaps_csv(self):
        r = client.get("/api/overlaps.csv", params={"tier": 1})
        assert r.status_code == 200
        assert "overlap_id" in r.text.splitlines()[0]

    def test_analysis_endpoints(self):
        for path in ("/api/analysis/timeline", "/api/analysis/calendar",
                     "/api/analysis/clusters", "/api/analysis/playbook",
                     "/api/analysis/conflicts", "/api/meta"):
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
