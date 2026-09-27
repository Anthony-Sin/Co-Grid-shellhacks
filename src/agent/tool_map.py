"""map_focus tool — the agent's handle on the interactive map.

Unlike the data tools, this one changes the UI. It validates the request
against the same processed artifacts every other tool uses, then returns
a `ui_action` payload the frontend applies to the map store (select +
fly-to a record, restrict visible tiers, filter to one utility, or reset
everything). Unknown ids return honest errors — never a fabricated
target (AGENTS.md §7).

The `ui_action` dict is consumed verbatim by the dashboard:
    select_overlap  -> select the overlap + fly the camera to its zone
    select_project  -> select the project + fly to its centroid
    utility_filter  -> set the utility filter to exactly this list
    tiers           -> set visible tiers to exactly this subset of 1-4
    focus_view      -> fly the camera to {lon, lat} (place/metro/facility)
    clear           -> reset selection + all map filters to defaults
"""
from __future__ import annotations

from typing import Any

from .tool_data import load_processed, overlaps, projects

_TIERS = (1, 2, 3, 4)

# Place names ("zoom to Atlanta") resolve to real artifact centers — the
# metro extracts' own `center` fields, not hand-typed coordinates. A name
# that matches no metro falls through to the facility gazetteer; nothing
# matched = an honest error, never a fabricated target.
_METRO_ARTIFACTS = {
    "savannah": "city_savannah",
    "augusta": "city_augusta",
    "atlanta": "city_atlanta",
    "columbia": "city_columbia",
    "charleston": "city_charleston",
    "greenville": "city_greenville_sc",
    "columbus": "city_columbus_ga",
    "athens": "city_athens",
    "macon": "city_macon",
}


def _resolve_place(place: str) -> tuple[float, float, str] | None:
    """Place name -> (lon, lat, resolved-name) via metro centers then the
    facility gazetteer. None when nothing real matches."""
    q = "".join(c for c in place.lower() if c.isalnum())
    q = q.removesuffix("georgia").removesuffix("sc").removesuffix("ga") or q
    hit = next((art for name, art in _METRO_ARTIFACTS.items()
                if name == q or (len(q) >= 5 and (q in name or name in q))), None)
    if hit:
        try:
            center = load_processed(f"{hit}.json").get("center")
            if center:
                return center[0], center[1], hit.removeprefix("city_").replace("_", " ")
        except FileNotFoundError:
            pass
    # facility fallback — same fuzzy index the gazetteer tool exposes
    try:
        from .tool_data import tool_gazetteer
        m = (tool_gazetteer(place).get("matches") or [])
        best = next((e for e in m
                     if isinstance(e.get("lon"), (int, float))
                     and isinstance(e.get("lat"), (int, float))), None)
        if best:
            return float(best["lon"]), float(best["lat"]), str(best["name"])
    except Exception:
        pass
    return None


def _find_overlap(oid: str) -> dict | None:
    return next((r for r in overlaps() if r.get("overlap_id") == oid), None)


def _find_project(pid: str) -> dict | None:
    return next((f["properties"] for f in projects()
                 if f["properties"].get("project_id") == pid), None)


def _coerce_tiers(raw: Any) -> list[int] | None:
    """Accept 1, [1, 2], "1,2", "[1, 2]" — small models emit all of these."""
    if isinstance(raw, bool):
        return None
    if isinstance(raw, str):
        raw = raw.strip().strip("[]").replace(",", " ").split()
    elif isinstance(raw, (int, float)):
        raw = [raw]
    if not isinstance(raw, (list, tuple)):
        return None
    try:
        return [int(t) for t in raw]
    except (TypeError, ValueError):
        return None


def _truthy(raw: Any) -> bool:
    """`clear` may arrive as a bool or a string — "false" is truthy in
    Python, so coerce the common spellings before trusting it."""
    if isinstance(raw, str):
        return raw.strip().lower() in ("true", "1", "yes")
    return bool(raw)


def tool_map_focus(overlap_id: str | None = None,
                   project_id: str | None = None,
                   utility: str | None = None,
                   tiers: Any = None,
                   place: str | None = None,
                   clear: Any = False) -> dict:
    """Validate a map-driving request; return the ui_action to apply."""
    action: dict[str, Any] = {}
    notes: list[str] = []

    if overlap_id:
        oid = str(overlap_id).strip()
        rec = _find_overlap(oid)
        if not rec:
            return {"ok": False,
                    "error": f"no overlap '{oid}' — get real ids from "
                             "top_overlaps/find_overlaps first"}
        action["select_overlap"] = oid
        notes.append(
            f"zoom to {oid} ({'×'.join(rec.get('utilities') or [])}, "
            f"tier {rec.get('tier')} {rec.get('tier_label')})")

    if project_id:
        pid = str(project_id).strip()
        props = _find_project(pid)
        if not props:
            return {"ok": False,
                    "error": f"no project '{pid}' — get real ids from "
                             "list_projects/project_overlaps first"}
        action["select_project"] = pid
        notes.append(f"select project {pid} ({props.get('name')})")

    if utility:
        known = sorted({f["properties"].get("utility")
                        for f in projects()} - {None})
        canon = next((u for u in known
                      if u.lower() == str(utility).strip().lower()), None)
        if canon is None:
            return {"ok": False,
                    "error": f"unknown utility '{utility}' — "
                             f"known: {', '.join(known)}"}
        action["utility_filter"] = [canon]
        notes.append(f"filter to {canon}")

    if tiers is not None:
        coerced = _coerce_tiers(tiers)
        valid = sorted({t for t in (coerced or []) if t in _TIERS})
        if coerced is None or not valid or len(valid) != len(set(coerced)):
            return {"ok": False,
                    "error": f"tiers must be ints in 1-4 — got {tiers!r}"}
        action["tiers"] = valid
        notes.append(f"show tiers {valid}")

    if place:
        resolved = _resolve_place(str(place))
        if resolved is None:
            return {"ok": False,
                    "error": f"couldn't place '{place}' — try a metro name "
                             f"({', '.join(sorted(_METRO_ARTIFACTS))}), an "
                             "overlap/project id, or a facility name"}
        lon, lat, name = resolved
        action["focus_view"] = {"lon": lon, "lat": lat}
        notes.append(f"fly to {name} ({lon:.3f}, {lat:.3f})")

    if _truthy(clear):
        action["clear"] = True
        notes.append("reset selection + filters")

    if not action:
        return {"ok": False,
                "error": "map_focus needs at least one of: overlap_id, "
                         "project_id, utility, tiers, place, clear"}

    return {"ok": True, "ui_action": action, "applied": "; ".join(notes)}
