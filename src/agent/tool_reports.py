"""Rollup/report tools — one-shot synthesized briefs over the stored
records (zone, utility, season, savings, voltage-class, crew relays).
"""
from __future__ import annotations

from .tool_data import overlaps, projects


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


def tool_utility_profile(utility: str) -> dict:
    """One-shot brief for one utility: project count/kinds, filed-window
    span, coordination partners (with record counts), tier histogram of
    its records, and its top-3 scored opportunities."""
    u = (utility or "").strip()
    if not u:
        return {"error": "utility required"}
    projs = [f["properties"] for f in projects()
             if f["properties"].get("utility") == u]
    rows = [r for r in overlaps() if u in (r.get("utilities") or [])]
    if not projs and not rows:
        return {"error": f"no projects or overlaps for '{u}'",
                "hint": "stats.projects_by_utility lists real names"}
    kinds: dict[str, int] = {}
    starts, ends = [], []
    for p in projs:
        k = p.get("kind") or "?"
        kinds[k] = kinds.get(k, 0) + 1
        if p.get("start_year") is not None:
            starts.append(p["start_year"])
        if p.get("end_year") is not None:
            ends.append(p["end_year"])
    partners: dict[str, int] = {}
    for r in rows:
        other = next((x for x in r.get("utilities", []) if x != u), "?")
        partners[other] = partners.get(other, 0) + 1
    return {
        "utility": u,
        "projects": len(projs),
        "project_kinds": dict(sorted(kinds.items(), key=lambda kv: -kv[1])),
        "program_window": {
            "earliest_start": min(starts) if starts else None,
            "latest_end": max(ends) if ends else None,
        },
        "location_confidence": {
            c: sum(1 for p in projs if p.get("location_confidence") == c)
            for c in ("verified", "approximate", "endpoint_only")
        },
        "overlap_records": len(rows),
        "tiers": {str(t): sum(1 for r in rows if r["tier"] == t)
                  for t in (1, 2, 3, 4)},
        "timeline_matches": sum(1 for r in rows if r.get("timeline_overlap")),
        "partners": dict(sorted(partners.items(), key=lambda kv: -kv[1])),
        "top_records": [{
            "overlap_id": r["overlap_id"], "utilities": r.get("utilities"),
            "tier": r["tier"], "score": r.get("score"),
        } for r in sorted(rows, key=lambda x: -(x.get("score") or 0))[:3]],
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


def tool_handoff_chains() -> dict:
    """Crew-relay chains: maximal sequences of adjacent (end-to-start)
    records a shared crew could physically roll through — A finishes
    2027 as B starts 2027, B finishes 2029 as C starts... Each hop is a
    real overlap record; edges are directed by filed windows."""
    from src.analysis.handoffs import build_handoff_chains
    windows = {f["properties"].get("project_id"):
               (f["properties"].get("start_year"),
                f["properties"].get("end_year")) for f in projects()}
    return build_handoff_chains(overlaps(), windows)


def tool_voltage_match(tier: int | None = None, limit: int = 25) -> dict:
    """Equipment-class view: records where both projects run the same
    voltage (shared conductor/hardware family) vs interface pairs
    (different kV — autobank/transformer coordination). Buckets by
    voltage class; a tier filter narrows scope."""
    projs = {f["properties"].get("project_id"): f["properties"]
             for f in projects()}
    rows = overlaps()
    if tier is not None:
        rows = [r for r in rows if r.get("tier") == int(tier)]
    same, interface = [], []
    for r in rows:
        va = (projs.get(r.get("project_a")) or {}).get("voltage_kv")
        vb = (projs.get(r.get("project_b")) or {}).get("voltage_kv")
        entry = {"overlap_id": r["overlap_id"], "tier": r["tier"],
                 "kv_a": va, "kv_b": vb, "score": r.get("score"),
                 "shared_window": r.get("shared_window")}
        (same if va is not None and va == vb else interface).append(entry)
    by_class: dict[str, int] = {}
    for e in same:
        k = f"{e['kv_a']} kV"
        by_class[k] = by_class.get(k, 0) + 1
    lim = max(1, min(int(limit or 25), 50))
    return {
        "scope_tier": tier,
        "same_voltage_records": len(same),
        "interface_records": len(interface),
        "same_by_voltage_class": dict(sorted(
            by_class.items(), key=lambda kv: -kv[1])),
        "top_same_voltage": sorted(same, key=lambda x: -(x["score"] or 0))[:lim],
        "top_interface": sorted(interface, key=lambda x: -(x["score"] or 0))[:lim],
        "note": ("same kV both sides = shared equipment family "
                 "(conductor, insulators, hardware); interface pairs "
                 "coordinate across voltage classes (autobank ties)"),
    }


