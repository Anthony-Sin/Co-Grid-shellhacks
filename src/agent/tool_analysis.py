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


def tool_zone_report(zone: str) -> dict:
    """One-shot brief for a zone tag: projects, overlap totals, tier
    histogram, dominant utility pair, top-ranked records."""
    z = (zone or "").strip().lower()
    if not z:
        return {"error": "zone required"}
    projs = [f for f in projects()
             if z in [str(x).lower() for x in (f["properties"].get("zones") or [])]]
    rows = [r for r in overlaps() if z in (r.get("zone") or "").lower()]
    if not projs and not rows:
        return {"error": f"no projects or overlaps tagged '{zone}'",
                "hint": "stats.zones_available lists the real tags"}
    tiers = {str(t): sum(1 for r in rows if r["tier"] == t) for t in (1, 2, 3, 4)}
    pairs: dict[str, int] = {}
    for r in rows:
        key = " × ".join(sorted(r.get("utilities") or []))
        pairs[key] = pairs.get(key, 0) + 1
    dominant = max(pairs.items(), key=lambda kv: kv[1])[0] if pairs else None
    missing_dates = sum(1 for f in projs
                        if f["properties"].get("start_year") is None)
    return {
        "zone": zone,
        "projects": len(projs),
        "projects_missing_dates": missing_dates,
        "overlaps": len(rows),
        "tiers": tiers,
        "timeline_matches": sum(1 for r in rows if r.get("timeline_overlap")),
        "dominant_pair": dominant,
        "top_records": [{
            "overlap_id": r["overlap_id"], "tier": r["tier"],
            "min_distance_km": r["min_distance_km"], "score": r.get("score"),
        } for r in rows[:3]],
    }


def tool_savings_rollup(zone: str | None = None, utility: str | None = None,
                        tier_max: int = 2) -> dict:
    """Aggregate sharing value across filtered records — 'what is the
    corridor worth?' Summed from stored per-record cost fields; tiers
    above `tier_max` carry $0 ROW savings (logistics basis only)."""
    rows = overlaps()
    if utility:
        u = str(utility).strip()
        rows = [r for r in rows if u in (r.get("utilities") or [])]
    if zone:
        z = str(zone).strip().lower()
        rows = [r for r in rows if z in (r.get("zone") or "").lower()]
    tm = max(1, min(int(tier_max or 2), 4))
    priced = [r for r in rows if r["tier"] <= tm and r.get("cost")]
    unpriced = [r for r in rows if r["tier"] <= tm and not r.get("cost")]
    low = sum((r["cost"] or {}).get("est_savings_usd_low") or 0 for r in priced)
    high = sum((r["cost"] or {}).get("est_savings_usd_high") or 0 for r in priced)
    km = sum((r["cost"] or {}).get("shared_row_km") or 0.0 for r in priced)
    acres = sum((r["cost"] or {}).get("shared_row_acres") or 0.0 for r in priced)
    return {
        "filter": {"zone": zone, "utility": utility, "tier_max": tm},
        "records_in_scope": len([r for r in rows if r["tier"] <= tm]),
        "priced_records": len(priced),
        "records_without_cost": len(unpriced),
        "total_est_savings_usd_low": low,
        "total_est_savings_usd_high": high,
        "total_shared_row_km": round(km, 2),
        "total_shared_row_acres": round(acres, 1),
        "basis": ("summed stored cost fields — same model as "
                  "/api/analysis/impact; tiers 3-4 price $0 land (logistics "
                  "sharing only, no acreage invented)"),
    }


def tool_what_if_shift(project_id: str, new_start: int, new_end: int) -> dict:
    """Counterfactual: if one project's build window moved to
    [new_start, new_end], which of its overlap records keep a timeline
    relationship? Recomputed honestly from the OTHER project's filed
    window — clearly labeled hypothetical, never stored."""
    pid = (project_id or "").strip()
    projs = {f["properties"].get("project_id"): f["properties"]
             for f in projects()}
    if pid not in projs:
        return {"error": f"no project '{project_id}'"}
    try:
        ns, ne = int(new_start), int(new_end)
    except (TypeError, ValueError):
        return {"error": "new_start/new_end must be integer years"}
    if ne < ns:
        return {"error": "new_end must be >= new_start"}
    from src.spatial.timeline import windows_overlap
    rows = [r for r in overlaps()
            if r.get("project_a") == pid or r.get("project_b") == pid]
    out = []
    gained = kept = lost = 0
    for r in rows:
        other = (r.get("project_b") if r.get("project_a") == pid
                 else r.get("project_a"))
        op = projs.get(other) or {}
        kind, win = windows_overlap(ns, ne, op.get("start_year"), op.get("end_year"))
        was = ("intersect" if r.get("timeline_overlap")
               else "adjacent" if r.get("timeline_adjacent") else "none")
        now = kind or "none"
        if was == "none" and now != "none": gained += 1
        elif was != "none" and now == "none": lost += 1
        elif now != "none": kept += 1
        out.append({
            "overlap_id": r["overlap_id"], "against": other,
            "other_window": {"start": op.get("start_year"),
                             "end": op.get("end_year")},
            "was": was, "would_be": now, "would_window": win,
        })
    return {
        "hypothetical": True,
        "project_id": pid,
        "filed_window": {"start": projs[pid].get("start_year"),
                         "end": projs[pid].get("end_year")},
        "shifted_window": {"start": ns, "end": ne},
        "records_evaluated": len(rows),
        "kept_relationship": kept, "lost_relationship": lost,
        "gained_relationship": gained,
        "per_record": out[:40],
    }


def tool_what_if_drop_utility(utility: str) -> dict:
    """Counterfactual partner exit: if one utility's projects left the
    dataset, every record touching it dies (a record needs both
    parties). Reports which coordination value disappears and which
    partners lose the most — labeled hypothetical, never stored."""
    u = (utility or "").strip()
    if not u:
        return {"error": "utility required"}
    allr = overlaps()
    dead = [r for r in allr if u in (r.get("utilities") or [])]
    if not dead:
        return {"error": f"no records involve utility '{u}'",
                "hint": "check spelling against stats.utilities"}
    by_tier: dict[str, int] = {}
    partners: dict[str, int] = {}
    for r in dead:
        by_tier[str(r["tier"])] = by_tier.get(str(r["tier"]), 0) + 1
        other = next((x for x in r.get("utilities", []) if x != u), "?")
        partners[other] = partners.get(other, 0) + 1
    partner_totals = {p: sum(1 for r in allr if p in (r.get("utilities") or []))
                      for p in partners}
    affected = sorted(
        ({"utility": p, "records_lost": n,
          "their_total_records": partner_totals[p],
          "pct_of_their_program": round(100 * n / partner_totals[p], 1)}
         for p, n in partners.items()),
        key=lambda x: -x["records_lost"])
    top_lost = sorted(dead, key=lambda r: -(r.get("score") or 0))[:5]
    return {
        "hypothetical": True,
        "dropped_utility": u,
        "records_lost": len(dead),
        "pct_of_all_records": round(100 * len(dead) / len(allr), 1),
        "lost_by_tier": dict(sorted(by_tier.items())),
        "partners_most_affected": affected,
        "top_lost_records": [
            {"overlap_id": r["overlap_id"], "utilities": r.get("utilities"),
             "tier": r["tier"], "score": r.get("score"),
             "shared_window": r.get("shared_window")}
            for r in top_lost],
        "note": ("every record needs both parties — exit removes ALL "
                 "records touching the utility, including joint outages "
                 "already scheduled"),
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


def tool_season_calendar(year: int | None = None) -> dict:
    """Coordination calendar — schedulable overlaps bucketed by shared-
    window start year. Pass `year` for one season's slate; omit for the
    whole calendar (year -> record counts, ids score-sorted)."""
    from src.analysis.calendar import build_calendar
    cal = build_calendar(overlaps())
    if year is None:
        return {
            "by_start_year": {y: len(v) for y, v in
                              cal["by_start_year"].items()},
            "top_per_year": {y: [r["overlap_id"] for r in v[:3]]
                             for y, v in cal["by_start_year"].items()},
            "overlaps_without_window": cal["overlaps_without_window"],
            "adjacent_only": cal["adjacent_only"],
            "note": cal["note"],
        }
    rows = cal["by_start_year"].get(str(int(year)), [])
    return {
        "year": int(year),
        "schedulable_records": len(rows),
        "overlaps": rows[:40],
        "truncated": len(rows) > 40,
        "note": ("only true window intersections are scheduled — adjacent "
                 "(end-to-start) records are coordination handoffs, not "
                 "concurrent work"),
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
