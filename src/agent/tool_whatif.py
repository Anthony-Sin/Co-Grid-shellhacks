"""Counterfactual tools — labeled hypothetical what-ifs that recompute
relationships over the stored records without ever mutating them
(schedule slips, partner exits).
"""
from __future__ import annotations

from .tool_data import overlaps, projects


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

