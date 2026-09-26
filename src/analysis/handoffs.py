"""Crew-relay chains — sequences of coordination records whose windows
roll end-to-start (the `timeline_adjacent` class). A hop X->Y means
project X's filed window ends (within slack) as project Y's begins —
a shared crew could physically roll from X's site to Y's.

Edges are DIRECTED by the real filed windows (earlier-end -> later-
start). Nodes are project_ids; paths never revisit a project (a crew
leaves a site once finished) and are capped at MAX_CHAIN_LEN hops.
"""
from __future__ import annotations

MAX_CHAIN_LEN = 5


def build_handoff_chains(records: list[dict],
                         windows: dict[str, tuple[int | None, int | None]],
                         max_len: int = MAX_CHAIN_LEN) -> dict:
    """Maximal end-to-start relay paths over adjacent-window records.

    `windows`: project_id -> (start_year, end_year) — needed to orient
    each adjacent record's direction (the overlap record stores only
    the gap years, not which side is earlier).
    """
    edges: dict[str, list[dict]] = {}
    for r in records:
        if not (r.get("timeline_adjacent") and not r.get("timeline_overlap")):
            continue
        a, b = r.get("project_a"), r.get("project_b")
        wa, wb = windows.get(a), windows.get(b)
        if not a or not b or not wa or not wb:
            continue
        a_start, a_end, b_start, b_end = wa[0], wa[1], wb[0], wb[1]
        win = r.get("adjacent_window") or {}
        hop = {
            "overlap_id": r.get("overlap_id"),
            "handoff_years": [win.get("start"), win.get("end")],
            "zone": r.get("zone"),
            "tier": r.get("tier"),
        }
        # earlier-ending project hands off to the later-starting one;
        # exact-touch windows legitimately run both directions
        if a_end is not None and b_start is not None and a_end <= b_start:
            edges.setdefault(a, []).append(
                {**hop, "from_project": a, "to_project": b})
        if b_end is not None and a_start is not None and b_end <= a_start:
            edges.setdefault(b, []).append(
                {**hop, "from_project": b, "to_project": a})

    chains: list[list[dict]] = []

    def walk(node: str, path: set, hops: list[dict]) -> None:
        nxt = [e for e in edges.get(node, []) if e["to_project"] not in path]
        if not nxt or len(hops) >= max_len:
            if hops:
                chains.append(hops)
            return
        for e in nxt:
            walk(e["to_project"], path | {e["to_project"]}, hops + [e])

    for start in edges:
        walk(start, {start}, [])

    # keep only maximal paths — a chain that's a strict prefix of a
    # longer one adds no information
    chains.sort(key=len, reverse=True)
    keys = [tuple(h["overlap_id"] for h in hops) for hops in chains]
    maximal: list[list[dict]] = []
    for i, hops in enumerate(chains):
        if not any(len(keys[j]) > len(keys[i])
                   and keys[j][: len(keys[i])] == keys[i]
                   for j in range(len(keys))):
            maximal.append(hops)
        if len(maximal) >= 20:
            break
    return {
        "metric": "handoff_chains",
        "chains_found": len(maximal),
        "chains": [{
            "length_hops": len(hops),
            "projects": [hops[0]["from_project"]]
                        + [h["to_project"] for h in hops],
            "hops": hops,
        } for hops in maximal],
        "note": ("chains link ONLY end-to-start handoff records — each "
                 "hop is a distinct real overlap record under 40 km; a "
                 "crew finishing one site could roll into the next"),
    }
