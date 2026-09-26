"""Tool registry — every function the analyst model may call.

Each tool reads ONLY from data/processed artifacts (the same files the
public API serves). No network, no mutation, no fabricated data. Results
are compact dicts/lists tuned for small-model consumption — trimmed fields,
bounded list lengths, explicit nulls for missing values.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "processed"


@lru_cache(maxsize=16)
def _cached(name: str, mtime: float) -> Any:  # noqa: ARG001 — mtime busts cache
    return json.loads((PROCESSED / name).read_text())


def _load(name: str) -> Any:
    p = PROCESSED / name
    if not p.exists():
        raise FileNotFoundError(f"{name} missing — run scripts/pipeline.sh")
    return _cached(name, p.stat().st_mtime)


def _projects() -> list[dict]:
    return _load("projects.geojson").get("features", [])


def _overlaps() -> list[dict]:
    return _load("overlaps.json").get("overlaps", [])


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
    projs, ovs = _projects(), _overlaps()
    by_util: dict[str, int] = {}
    by_tier: dict[str, int] = {}
    for f in projs:
        u = f["properties"].get("utility", "?")
        by_util[u] = by_util.get(u, 0) + 1
    for o in ovs:
        t = str(o["tier"])
        by_tier[t] = by_tier.get(t, 0) + 1
    return {
        "projects": len(projs),
        "by_utility": by_util,
        "overlaps": len(ovs),
        "by_tier": by_tier,
        "timeline_matches": sum(1 for o in ovs if o["timeline_overlap"]),
    }


def tool_list_projects(utility: str | None = None, zone: str | None = None,
                       limit: int = 30) -> dict:
    """List planned projects, optionally filtered by utility or zone tag."""
    feats = _projects()
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
    for f in _projects():
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
    rows = _overlaps()
    if tier is not None:
        rows = [r for r in rows if r["tier"] == tier]
    if timeline_only:
        rows = [r for r in rows if r["timeline_overlap"]]
    rows = sorted(rows, key=lambda r: r.get("score", 0), reverse=True)[: max(1, min(n, 50))]
    return {"shown": len(rows), "overlaps": [_overlap_brief(r) for r in rows]}


def tool_get_overlap(overlap_id: str) -> dict:
    """Full detail for one overlap: closest points, shared window, zone size."""
    for r in _overlaps():
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
    for f in _projects():
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


def tool_timeline_summary() -> dict:
    """Year-by-year build activity — defers to src.analysis when present."""
    try:
        from src.analysis.timeline import build_timeline  # late import — optional module
        return build_timeline(_load("projects.geojson"), {"overlaps": _overlaps()})
    except Exception as e:  # module may not exist yet — degrade honestly
        projs = _projects()
        years: dict[str, dict[str, int]] = {}
        missing = 0
        for f in projs:
            p = f["properties"]
            s, e = p.get("start_year"), p.get("end_year")
            if s is None or e is None:
                missing += 1
                continue
            for y in range(int(s), int(e) + 1):
                bucket = years.setdefault(str(y), {})
                u = p.get("utility", "?")
                bucket[u] = bucket.get(u, 0) + 1
        return {"per_year": dict(sorted(years.items())), "projects_missing_dates": missing,
                "note": f"basic summary (analysis module unavailable: {type(e).__name__})"}


_SHAREABLE_BY_TIER = {
    1: ["crossing-structure design", "joint outage scheduling",
        "shared right-of-way & permits", "laydown yards", "crew swap"],
    2: ["shared right-of-way & access roads", "joint permitting",
        "laydown yards", "crew swap", "equipment pooling"],
    3: ["laydown yards & deliveries", "crew swap", "equipment pooling",
        "shared staging site"],
    4: ["crew & contractor pooling", "equipment pooling",
        "shared staging region"],
}


def _shareable_by_tier(tier: int | None) -> list[str]:
    return list(_SHAREABLE_BY_TIER.get(tier, []))


def _staging_note(dist_km: float) -> str:
    if dist_km <= 20:
        return ("single staging yard can serve both sites "
                "(well inside 40 km crew radius)")
    return ("a shared staging yard is feasible but sits toward the edge "
            "of a 40 km crew radius")


def tool_data_health() -> dict:
    """Honest quality report: missing dates, location confidence, provenance —
    so the agent can answer 'how good is this data' without guessing."""
    projs = _projects()
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
            from urllib.parse import urlparse
            u = urlparse(s.split(" ")[0])
            stem = u.path.rsplit("/", 1)[-1].replace(".pdf", "")[:48]
            s = f"{u.netloc} → {stem}" if stem else u.netloc
        src_counts[s] = src_counts.get(s, 0) + 1
        k = p.get("kind") or "unknown"
        kind_counts[k] = kind_counts.get(k, 0) + 1
    ovs = _overlaps()
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


def tool_gazetteer(name: str, limit: int = 10) -> dict:
    """Fuzzy-lookup real facilities (substations/plants) by name — resolves
    WHERE a filed project sits when the record only names a substation."""
    try:
        gaz = _load("gazetteer.json")
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


def tool_impact_estimate(overlap_id: str) -> dict:
    """Per-overlap resource-sharing analysis — what the two utilities could
    jointly use, grounded in the record's tier/distance/timeline/cost fields."""
    rec = next((r for r in _overlaps() if r.get("overlap_id") == overlap_id), None)
    if not rec:
        return {"error": f"no overlap '{overlap_id}'"}

    # Richer path: src/analysis computes shared-corridor km in UTM + savings
    # ranges from geometry — prefer it when the module is importable.
    try:
        from src.analysis.impact import build_impacts
        impacts = {i["overlap_id"]: i
                   for i in build_impacts(_load("projects.geojson"),
                                          {"overlaps": _overlaps()})}
        imp = impacts.get(overlap_id)
    except Exception:
        imp = None
    if imp:
        imp = dict(imp)
        imp["shareable_resources"] = _shareable_by_tier(rec.get("tier"))
        imp["staging_logistics"] = _staging_note(rec.get("min_distance_km") or 0.0)
        imp["tier_label"] = rec.get("tier_label")
        if not rec.get("timeline_overlap"):
            imp["caution"] = ("timelines do not intersect — coordination only "
                              "pays off if schedules can be aligned")
        return imp

    tier = rec.get("tier")
    win = rec.get("shared_window") or {}
    months = None
    if win.get("start") and win.get("end"):
        months = int((win["end"] - win["start"] + 1) * 12)

    dist = rec.get("min_distance_km") or 0.0
    out = {
        "overlap_id": overlap_id,
        "tier": tier,
        "tier_label": rec.get("tier_label"),
        "min_distance_km": dist,
        "timeline_overlap": rec.get("timeline_overlap"),
        "shared_months": months,
        "shareable_resources": _shareable_by_tier(tier),
        "staging_logistics": _staging_note(dist),
        "cost": rec.get("cost"),
    }
    if not rec.get("timeline_overlap"):
        out["caution"] = ("timelines do not intersect — coordination only pays off "
                          "if schedules can be aligned")
    if not rec.get("cost"):
        out["cost_note"] = ("no stored cost record — savings must be estimated from "
                            "shared-ROW length and local land/corridor costs")
    return out


# ------------------------------------------------------------ registration

TOOLS: dict[str, tuple[Callable[..., Any], str, dict]] = {
    "stats": (tool_stats, "Dataset-wide counts: projects per utility, overlaps per tier.", {}),
    "list_projects": (
        tool_list_projects,
        "List planned utility projects. Filter by utility ('DESC','GPC','SanteeCooper') or zone tag.",
        {"utility": "string (optional)", "zone": "string (optional)", "limit": "int <=50 (optional)"},
    ),
    "get_project": (
        tool_get_project,
        "Full record of one planned project by project_id.",
        {"project_id": "string (required)"},
    ),
    "top_overlaps": (
        tool_top_overlaps,
        "Top-N ranked coordination opportunities. Optional tier (1-4) and timeline_only filters.",
        {"n": "int <=50 (optional)", "tier": "int 1-4 (optional)", "timeline_only": "bool (optional)"},
    ),
    "get_overlap": (
        tool_get_overlap,
        "Full detail for one overlap record by overlap_id.",
        {"overlap_id": "string (required)"},
    ),
    "projects_near": (
        tool_projects_near,
        "Planned projects within `km` of a lon/lat point.",
        {"lon": "float (required)", "lat": "float (required)", "km": "float 1-200 (optional)"},
    ),
    "timeline_summary": (
        tool_timeline_summary,
        "Per-year build activity per utility + overlap-window stats.",
        {},
    ),
    "impact_estimate": (
        tool_impact_estimate,
        "Resource-sharing analysis for one overlap: what can be jointly used, "
        "staging logistics, shared build-months, stored cost figures.",
        {"overlap_id": "string (required)"},
    ),
    "gazetteer": (
        tool_gazetteer,
        "Resolve real grid facilities (substations, plants) by name to lon/lat "
        "— use when a project references a named facility.",
        {"name": "string (required)", "limit": "int <=25 (optional)"},
    ),
    "data_health": (
        tool_data_health,
        "Dataset quality report: missing build dates, location-confidence "
        "breakdown, source families, overlap timeline coverage.",
        {},
    ),
}


def openai_tool_specs() -> list[dict]:
    """OpenAI `tools` payload — permissive schemas (small models)."""
    specs = []
    for name, (_, desc, props) in TOOLS.items():
        spec_props = {
            k: {"type": "number" if "float" in v else "integer" if "int" in v
                else "boolean" if "bool" in v else "string",
                "description": v}
            for k, v in props.items()
        }
        required = [k for k, v in props.items() if "required" in v]
        specs.append({
            "type": "function",
            "function": {
                "name": name,
                "description": desc,
                "parameters": {"type": "object", "properties": spec_props,
                               "required": required},
            },
        })
    return specs


def run_tool(name: str, args: dict) -> dict:
    """Execute a tool safely — unknown tools / bad args become data, not crashes."""
    entry = TOOLS.get(name)
    if not entry:
        return {"error": f"unknown tool '{name}'"}
    fn = entry[0]
    try:
        clean = {k: v for k, v in (args or {}).items() if v is not None}
        return {"ok": True, "result": fn(**clean)}
    except TypeError as e:
        return {"error": f"bad args for {name}: {e}"}
    except FileNotFoundError as e:
        return {"error": str(e)}
    except Exception as e:  # never let a tool crash the loop
        return {"error": f"{name} failed: {type(e).__name__}: {e}"}
