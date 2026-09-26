"""Analysis tools — defer to src.analysis modules (timeline, impact,
clusters, playbook) with honest fallbacks, plus the challenge glossary.
"""
from __future__ import annotations

from src.processing.projection import scene_for_zone

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
    """Where shared staging yards could go — yard-servable clusters: every
    member site sits within radius_km of the cluster's yard_site. Answers
    'how many yards are needed and where' directly."""
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


def tool_utility_matrix() -> dict:
    """Utility-pair × tier matrix — which utility pairs overlap most."""
    records = overlaps()
    pairs: dict[str, dict] = {}
    for r in records:
        utils = sorted(set(r.get("utilities") or []))
        key = " × ".join(utils) if utils else "unknown"
        cell = pairs.setdefault(key, {
            "utilities": utils, "overlaps": 0,
            "by_tier": {"1": 0, "2": 0, "3": 0, "4": 0},
            "timeline_matches": 0, "best_distance_km": None,
        })
        cell["overlaps"] += 1
        cell["by_tier"][str(r["tier"])] += 1
        if r.get("timeline_overlap"):
            cell["timeline_matches"] += 1
        d = r.get("min_distance_km")
        if d is not None and (cell["best_distance_km"] is None or d < cell["best_distance_km"]):
            cell["best_distance_km"] = round(d, 3)
    rows = sorted(pairs.values(), key=lambda c: -c["overlaps"])
    return {"pairs": rows, "pair_count": len(rows)}


def tool_outage_conflicts() -> dict:
    """Must-coordinate subset: tier-1 touching/crossing overlaps whose
    build windows intersect — mandatory joint outage scheduling."""
    try:
        from src.analysis.conflicts import build_conflicts
        return build_conflicts({"overlaps": overlaps()})
    except Exception as e:
        return {"error": f"conflicts unavailable: {type(e).__name__}: {e}"}


def tool_exec_summary() -> dict:
    """Program headline numbers — one deterministic card for grounding
    openers like 'what does the data say overall?'."""
    try:
        from src.analysis.summary import build_summary
        return build_summary(load_processed("projects.geojson"),
                             {"overlaps": overlaps()})
    except Exception as e:
        return {"error": f"summary unavailable: {type(e).__name__}: {e}"}


def tool_compare_overlaps(overlap_ids) -> dict:
    """Side-by-side comparison of 2-8 overlap records — same fields per row
    plus a deltas summary (closest, earliest shared window, best score,
    largest savings high). Pass a list or a comma-joined string."""
    if isinstance(overlap_ids, str):
        overlap_ids = [x.strip() for x in overlap_ids.split(",") if x.strip()]
    if not isinstance(overlap_ids, list) or not 2 <= len(overlap_ids) <= 8:
        return {"error": "overlap_ids must be a list of 2-8 ids"}
    by_id = {r.get("overlap_id"): r for r in overlaps()}
    ids = [str(x) for x in overlap_ids]
    missing = [i for i in ids if i not in by_id]
    rows = [{
        "overlap_id": r.get("overlap_id"),
        "project_a": r.get("project_a"), "project_b": r.get("project_b"),
        "utilities": r.get("utilities"),
        "tier": r.get("tier"), "tier_label": r.get("tier_label"),
        "min_distance_km": r.get("min_distance_km"),
        "timeline_overlap": r.get("timeline_overlap"),
        "timeline_adjacent": r.get("timeline_adjacent"),
        "shared_window": r.get("shared_window"),
        "score": r.get("score"),
        "zone": r.get("zone"),
        "est_savings_usd_high": (r.get("cost") or {}).get("est_savings_usd_high"),
        "shared_row_km": (r.get("cost") or {}).get("shared_row_km"),
        "deep_link": (
            f"/?scene={scene_for_zone(r.get('zone'))}"
            f"&select={r.get('overlap_id')}&panel=0"),
    } for r in (by_id[i] for i in ids if i in by_id)]
    if not rows:
        return {"error": "none of the ids resolved", "missing": missing}
    def _best(rows, key, agg):
        vals = [(x.get(key), x["overlap_id"]) for x in rows if x.get(key) is not None]
        return agg(vals)[1] if vals else None
    out = {
        "records": rows, "missing": missing,
        "closest": _best(rows, "min_distance_km", min),
        "highest_scored": _best(rows, "score", max),
        "largest_savings_high": _best(rows, "est_savings_usd_high", max),
    }
    wins = [r for r in rows if r.get("shared_window")]
    if wins:
        out["earliest_shared_window"] = min(
            wins, key=lambda r: (r["shared_window"]["start"],
                                 r["shared_window"]["end"]))["overlap_id"]
    return out


def tool_why_ranked(overlap_id: str) -> dict:
    """Transparent score decomposition for one record — uses the same
    constants as src.spatial.ranker so the breakdown can never disagree
    with the stored score."""
    recs = overlaps()
    rec = next((r for r in recs if r.get("overlap_id") == overlap_id), None)
    if not rec:
        return {"error": f"no overlap '{overlap_id}'"}
    from src.spatial.ranker import (_ADJACENT_BONUS, _TIER_SCORE,
                                    _TIMELINE_BONUS, _distance_component,
                                    _voltage_bonus)
    tier = rec["tier"]
    parts = {
        "tier_base": _TIER_SCORE[tier],
        "distance_within_tier": round(_distance_component(rec["min_distance_km"], tier), 1),
        "timeline_intersect_bonus": (_TIMELINE_BONUS if rec.get("timeline_overlap")
                                     else _ADJACENT_BONUS if rec.get("timeline_adjacent")
                                     else 0.0),
        "voltage_bonus": round(_voltage_bonus(
            type("R", (), {"max_voltage_kv": rec.get("max_voltage_kv")})()), 1),
    }
    return {
        "overlap_id": overlap_id,
        "ranked_score": rec.get("score"),
        "components": parts,
        "rank_position": recs.index(rec) + 1,
        "of_records": len(recs),
        "explain": ("score = tier base + closeness-within-tier (0-10) + "
                    "timeline bonus (25 intersect / 12 adjacent / 0 none) + "
                    "voltage bonus (kV * 0.02, capped 10). Engine rank = "
                    "(tier asc, distance asc, timeline-first) — the score "
                    "is a display value, the tuple is the real sort."),
    }


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


def tool_overlap_neighbors(overlap_id: str, radius_km: float = 40.0) -> dict:
    """Staging neighborhood of one record — every other overlap whose
    midpoint a yard at this site could also reach. Same math as
    /api/analysis/nearby so the two surfaces can't diverge."""
    from src.analysis.nearby import build_nearby
    radius_km = max(1.0, min(float(radius_km), 200.0))
    res = build_nearby(overlaps(), overlap_id, radius_km)
    return res if res is not None else {"error": f"no overlap '{overlap_id}'"}


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
