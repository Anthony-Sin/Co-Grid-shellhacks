"""Analysis tools — defer to src.analysis modules (timeline, impact,
clusters, playbook) with honest fallbacks, plus the challenge glossary.
"""
from __future__ import annotations

from .tool_data import load_processed, overlaps, projects

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


def tool_timeline_summary() -> dict:
    """Year-by-year build activity — defers to src.analysis when present."""
    try:
        from src.analysis.timeline import build_timeline  # late import — optional module
        return build_timeline(load_processed("projects.geojson"),
                              {"overlaps": overlaps()})
    except Exception as e:  # module may not exist yet — degrade honestly
        years: dict[str, dict[str, int]] = {}
        missing = 0
        for f in projects():
            p = f["properties"]
            s, e2 = p.get("start_year"), p.get("end_year")
            if s is None or e2 is None:
                missing += 1
                continue
            for y in range(int(s), int(e2) + 1):
                bucket = years.setdefault(str(y), {})
                u = p.get("utility", "?")
                bucket[u] = bucket.get(u, 0) + 1
        return {"per_year": dict(sorted(years.items())), "projects_missing_dates": missing,
                "note": f"basic summary (analysis module unavailable: {type(e).__name__})"}


def tool_impact_estimate(overlap_id: str) -> dict:
    """Per-overlap resource-sharing analysis — what the two utilities could
    jointly use, grounded in the record's tier/distance/timeline/cost fields."""
    rec = next((r for r in overlaps() if r.get("overlap_id") == overlap_id), None)
    if not rec:
        return {"error": f"no overlap '{overlap_id}'"}

    # Richer path: src/analysis computes shared-corridor km in UTM + savings
    # ranges from geometry — prefer it when the module is importable.
    try:
        from src.analysis.impact import build_impacts
        impacts = {i["overlap_id"]: i
                   for i in build_impacts(load_processed("projects.geojson"),
                                          {"overlaps": overlaps()})}
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


def tool_staging_clusters(radius_km: float = 40.0, top: int = 8) -> dict:
    """Which overlaps share one crew yard — clustered by midpoint proximity.
    Answers 'where should a joint staging base go' directly."""
    try:
        from src.analysis.clusters import build_clusters
        out = build_clusters({"overlaps": overlaps()},
                             max(5.0, min(radius_km, 200.0)))
        out["clusters"] = out["clusters"][: max(1, min(top, 30))]
        return out
    except Exception as e:
        return {"error": f"clusters unavailable: {type(e).__name__}: {e}"}


def tool_playbook(radius_km: float = 40.0, top: int = 5) -> dict:
    """Executable joint-work schedule: seasons per staging cluster."""
    try:
        from src.analysis.optimize import build_playbook
    except Exception:
        return {"error": "playbook module unavailable"}
    try:
        res = build_playbook(
            {"overlaps": overlaps()},
            float(min(max(radius_km or 40, 5), 200)),
            int(min(max(top or 5, 1), 20)))
    except Exception as exc:
        return {"error": f"playbook failed: {exc}"}
    for cl in res.get("clusters", []):
        for s in cl.get("seasons", []):
            s["overlap_ids"] = s["overlap_ids"][:20]
    return res


def tool_outage_conflicts() -> dict:
    """Must-coordinate subset: tier-1 touching/crossing overlaps whose
    build windows intersect — mandatory joint outage scheduling."""
    try:
        from src.analysis.conflicts import build_conflicts
        return build_conflicts({"overlaps": overlaps()})
    except Exception as e:
        return {"error": f"conflicts unavailable: {type(e).__name__}: {e}"}


# Challenge glossary — verbatim domain vocabulary so the analyst can define
# terms correctly instead of paraphrasing from memory.
_GLOSSARY = {
    "transmission line": ("high-voltage line moving electricity long distances "
                          "between plants, substations, regions (vs local distribution lines)"),
    "substation": ("facility stepping voltage up/down and routing between lines — "
                   "a highway interchange for electricity"),
    "right-of-way": ("land strip a utility owns/has access to build or maintain a line; "
                     "shared ROW = shared land + permits"),
    "irp": ("Integrated Resource Plan — a utility's official long-term plan "
            "(DESC: 15-yr w/ SC PSC; GPC: 10-yr w/ GA PSC)"),
    "psc": "Public Service Commission — state regulator approving utility plans",
    "ferc": "Federal Energy Regulatory Commission — federal regulator above the PSCs",
    "order 1920": ("2024 FERC rule requiring coordinated long-term regional transmission "
                   "planning — the real-world driver of this challenge"),
    "sertp": ("Southeastern Regional Transmission Planning — coordination forum founded "
              "by Southern Company (GPC parent) + GTC + MEAG; DESC is joining"),
    "scrtp": ("South Carolina Regional Transmission Planning — DESC + Santee Cooper "
              "project-list process (our DESC data source); DESC is transitioning to SERTP"),
    "ceii": ("Critical Energy Infrastructure Information — confidential grid data; "
             "off-limits for this challenge, we use public filings only"),
    "40km rule": ("overlaps count when closest geometry points are within 40 km — "
                  "crew-drive range from a staging yard"),
    "tiers": ("ranking by distance: 1 touching | 2 <1.6km shared ROW | "
              "3 <8km logistics | 4 <40km crews"),
}


def tool_define(term: str) -> dict:
    """Define a grid-planning term from the challenge glossary."""
    q = (term or "").strip().lower()
    if not q:
        return {"error": "term required"}
    if q in _GLOSSARY:
        return {"term": q, "definition": _GLOSSARY[q]}
    fuzzy = [k for k in _GLOSSARY if q in k or k in q]
    if fuzzy:
        return {"matches": {k: _GLOSSARY[k] for k in fuzzy[:5]}}
    return {"error": f"not in glossary: {term}",
            "available": sorted(_GLOSSARY)}
