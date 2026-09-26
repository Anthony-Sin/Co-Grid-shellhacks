"""Data-access tools — load processed artifacts and answer record questions.

Each tool reads ONLY from data/processed artifacts (the same files the
public API serves). No network, no mutation, no fabricated data. Results
are compact dicts/lists tuned for small-model consumption — trimmed
fields, bounded list lengths, explicit nulls for missing values.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "processed"


@lru_cache(maxsize=16)
def _cached(name: str, mtime: float) -> Any:  # noqa: ARG001 — mtime busts cache
    return json.loads((PROCESSED / name).read_text())


def load_processed(name: str) -> Any:
    p = PROCESSED / name
    if not p.exists():
        raise FileNotFoundError(f"{name} missing — run scripts/pipeline.sh")
    return _cached(name, p.stat().st_mtime)


def projects() -> list[dict]:
    return load_processed("projects.geojson").get("features", [])


def overlaps() -> list[dict]:
    return load_processed("overlaps.json").get("overlaps", [])


def _proj_props(f: dict) -> dict:
    p = f.get("properties", {})
    return {
        "project_id": p.get("project_id"),
        "utility": p.get("utility"),
        "name": p.get("name"),
        "kind": p.get("kind"),
        "voltage_kv": p.get("voltage_kv"),
        "start_year": p.get("start_year"),
        "end_year": p.get("end_year"),
        "status": p.get("status"),
        "location_confidence": p.get("location_confidence"),
        "source": p.get("source"),
        "zones": p.get("zones"),
    }


def _overlap_brief(r: dict) -> dict:
    return {
        "overlap_id": r.get("overlap_id"),
        "project_a": r.get("project_a"),
        "project_b": r.get("project_b"),
        "utilities": r.get("utilities"),
        "tier": r.get("tier"),
        "tier_label": r.get("tier_label"),
        "min_distance_km": r.get("min_distance_km"),
        "timeline_overlap": r.get("timeline_overlap"),
        "shared_window": r.get("shared_window"),
        "score": r.get("score"),
    }


# --------------------------------------------------------------------- tools


def tool_stats() -> dict:
    """Dataset-wide counts: projects by utility, overlaps by tier."""
    projs, ovs = projects(), overlaps()
    by_util: dict[str, int] = {}
    by_tier: dict[str, int] = {}
    zones: set[str] = set()
    for f in projs:
        u = f["properties"].get("utility", "?")
        by_util[u] = by_util.get(u, 0) + 1
        zones.update(f["properties"].get("zones") or [])
    for o in ovs:
        t = str(o["tier"])
        by_tier[t] = by_tier.get(t, 0) + 1
    return {
        "projects": len(projs),
        "by_utility": by_util,
        "overlaps": len(ovs),
        "by_tier": by_tier,
        "timeline_matches": sum(1 for o in ovs if o["timeline_overlap"]),
        "zones_available": sorted(zones),
    }


def tool_list_projects(utility: str | None = None, zone: str | None = None,
                       limit: int = 30) -> dict:
    """List planned projects, optionally filtered by utility or zone tag."""
    feats = projects()
    if utility:
        feats = [f for f in feats if f["properties"].get("utility") == utility]
    if zone:
        feats = [f for f in feats if zone in (f["properties"].get("zones") or [])]
    return {
        "count": len(feats),
        "shown": min(len(feats), limit),
        "projects": [_proj_props(f) for f in feats[:limit]],
    }


def tool_get_project(project_id: str) -> dict:
    """Full record for one project (geometry summary + all properties)."""
    for f in projects():
        if f["properties"].get("project_id") == project_id:
            geom = f.get("geometry") or {}
            coords = geom.get("coordinates")
            n = len(coords) if isinstance(coords, list) else 0
            return {
                **_proj_props(f),
                "geometry_type": geom.get("type"),
                "geometry_points": n,
            }
    return {"error": f"no project '{project_id}'"}


def tool_top_overlaps(n: int = 10, tier: int | None = None,
                      timeline_only: bool = False) -> dict:
    """Top-N ranked coordination overlaps (score-sorted by the engine)."""
    rows = overlaps()
    if tier is not None:
        rows = [r for r in rows if r["tier"] == tier]
    if timeline_only:
        rows = [r for r in rows if r["timeline_overlap"]]
    rows = sorted(rows, key=lambda r: r.get("score", 0), reverse=True)[: max(1, min(n, 50))]
    return {"shown": len(rows), "overlaps": [_overlap_brief(r) for r in rows]}


def tool_get_overlap(overlap_id: str) -> dict:
    """Full detail for one overlap: closest points, shared window, zone size."""
    for r in overlaps():
        if r.get("overlap_id") == overlap_id:
            return {
                **_overlap_brief(r),
                "closest_point_a": r.get("closest_point_a"),
                "closest_point_b": r.get("closest_point_b"),
                "midpoint": r.get("midpoint"),
                "explanation": r.get("explanation"),
                "zone": r.get("zone"),
                "cost": r.get("cost"),
            }
    return {"error": f"no overlap '{overlap_id}'"}


def tool_projects_near(lon: float, lat: float, km: float = 25) -> dict:
    """Planned projects whose geometry has a vertex within `km` of a point."""
    def coords_of(geom: dict | None):
        if not geom:
            return
        def rec(c):
            if isinstance(c, list) and len(c) >= 2 and isinstance(c[0], (int, float)):
                yield c[0], c[1]
            elif isinstance(c, list):
                for cc in c:
                    yield from rec(cc)
        yield from rec(geom.get("coordinates"))

    km = max(1.0, min(km, 200.0))
    hits = []
    for f in projects():
        best = None
        for gx, gy in coords_of(f.get("geometry")):
            p1, p2 = math.radians(lat), math.radians(gy)
            dlat, dlon = p2 - p1, math.radians(gx - lon)
            d = 6371.0 * 2 * math.asin(math.sqrt(
                math.sin(dlat / 2) ** 2
                + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
            ))
            if best is None or d < best:
                best = d
        if best is not None and best <= km:
            hits.append({**_proj_props(f), "distance_km": round(best, 2)})
    hits.sort(key=lambda h: h["distance_km"])
    return {"center": [lon, lat], "radius_km": km, "count": len(hits), "projects": hits[:30]}


def tool_gazetteer(name: str, limit: int = 10) -> dict:
    """Fuzzy-lookup real facilities (substations/plants) by name — resolves
    WHERE a filed project sits when the record only names a substation."""
    try:
        gaz = load_processed("gazetteer.json")
    except FileNotFoundError:
        return {"error": "gazetteer.json missing — run the gazetteer build"}
    q = (name or "").strip().upper()
    if not q:
        return {"error": "name required"}
    scored = []
    for e in gaz:
        n = e.get("norm") or ""
        if q in n:
            score = len(q) / max(len(n), 1)
            scored.append((score, e))
    scored.sort(key=lambda t: t[0], reverse=True)
    return {
        "query": name,
        "count": len(scored),
        "matches": [
            {"name": e.get("name"), "layer": e.get("layer"),
             "lon": e.get("lon"), "lat": e.get("lat"), "src": e.get("src")}
            for _, e in scored[: min(limit, 25)]
        ],
    }


def tool_data_health() -> dict:
    """Honest quality report: missing dates, location confidence, provenance —
    so the agent can answer 'how good is this data' without guessing."""
    projs = projects()
    missing_dates, conf_counts, src_counts, kind_counts = [], {}, {}, {}
    for f in projs:
        p = f["properties"]
        if p.get("start_year") is None or p.get("end_year") is None:
            missing_dates.append(p.get("project_id"))
        c = p.get("location_confidence") or "unknown"
        conf_counts[c] = conf_counts.get(c, 0) + 1
        s = (p.get("source") or "unknown")
        if s.startswith("http"):
            # source family = host + the filing's filename stem
            u = urlparse(s.split(" ")[0])
            stem = u.path.rsplit("/", 1)[-1].replace(".pdf", "")[:48]
            s = f"{u.netloc} → {stem}" if stem else u.netloc
        src_counts[s] = src_counts.get(s, 0) + 1
        k = p.get("kind") or "unknown"
        kind_counts[k] = kind_counts.get(k, 0) + 1
    ovs = overlaps()
    return {
        "projects": len(projs),
        "projects_missing_dates": {
            "count": len(missing_dates),
            "ids": missing_dates[:15],
            "note": "shown without a build window; excluded from timeline bands",
        },
        "location_confidence": conf_counts,
        "source_families": src_counts,
        "project_kinds": kind_counts,
        "overlaps": {
            "total": len(ovs),
            "with_timeline": sum(1 for o in ovs if o["timeline_overlap"]),
            "without_timeline": sum(1 for o in ovs if not o["timeline_overlap"]),
        },
    }
