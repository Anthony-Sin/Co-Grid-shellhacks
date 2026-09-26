"""Analysis API router — exposes src/analysis outputs over HTTP.

Mounted by the app owner via `app.include_router(router)` in main.py
(NOT mounted here). Caching mirrors main.py: lru_cache keyed on the
source files' mtimes so regenerated artifacts bust automatically.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from .clusters import build_clusters
from .impact import build_impacts
from .timeline import build_timeline

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "processed"

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


def _load(name: str) -> dict:
    path = PROCESSED / name
    if not path.exists():
        raise HTTPException(503, f"{name} not generated yet — run the processing pipeline")
    return json.loads(path.read_text())


@lru_cache(maxsize=8)
def _cached(name: str, mtime: float) -> dict:  # noqa: ARG001 — mtime busts cache
    return _load(name)


def _mtime(name: str) -> float:
    path = PROCESSED / name
    return path.stat().st_mtime if path.exists() else 0.0


def _fresh(name: str) -> dict:
    return _cached(name, _mtime(name))


@lru_cache(maxsize=4)
def _timeline_cached(p_mtime: float, o_mtime: float) -> dict:  # noqa: ARG001
    return build_timeline(_fresh("projects.geojson"), _fresh("overlaps.json"))


@lru_cache(maxsize=4)
def _impacts_cached(p_mtime: float, o_mtime: float) -> list:  # noqa: ARG001
    return build_impacts(_fresh("projects.geojson"), _fresh("overlaps.json"))


def _timeline() -> dict:
    return _timeline_cached(_mtime("projects.geojson"), _mtime("overlaps.json"))


def _impacts() -> list:
    return _impacts_cached(_mtime("projects.geojson"), _mtime("overlaps.json"))


@router.get("/timeline")
def timeline() -> dict:
    """Yearly + quarterly active-project bands and shared-window stats."""
    return _timeline()


@router.get("/impacts")
def impacts(top: Optional[int] = Query(None, ge=1)) -> dict:
    """All per-overlap impact estimates; `?top=N` keeps the N highest
    est_savings_usd_range.high (nulls sort last)."""
    rows = _impacts()
    if top is not None:
        rows = sorted(
            rows,
            key=lambda r: (r.get("est_savings_usd_range") or {}).get("high") or -1,
            reverse=True,
        )[:top]
    return {"count": len(rows), "impacts": rows}


@router.get("/impact/{overlap_id}")
def impact(overlap_id: str) -> dict:
    """Single overlap's impact estimate, or 404."""
    for r in _impacts():
        if r.get("overlap_id") == overlap_id:
            return r
    raise HTTPException(404, f"no impact record for {overlap_id!r}")


@router.get("/playbook")
def playbook(radius_km: float = Query(40.0, ge=5.0, le=200.0),
             top: int = Query(10, ge=1, le=50)) -> dict:
    """Season-plan per staging cluster — executable joint-work schedule."""
    from .optimize import build_playbook
    return build_playbook(_fresh("overlaps.json"), radius_km, top)


@router.get("/matrix")
def matrix(zone: Optional[str] = Query(None, description="region tag filter")) -> dict:
    """Utility-pair × tier overlap matrix — which pairs coordinate most.
    `?zone=savannah` scopes the matrix to one region's records."""
    records = _fresh("overlaps.json").get("overlaps") or []
    if zone:
        z = zone.strip().lower()
        records = [r for r in records if z in (r.get("zone") or "").lower()]
    pairs: dict[str, dict] = {}
    for r in records:
        utils = sorted(set(r.get("utilities") or []))
        key = " × ".join(utils) if utils else "unknown"
        cell = pairs.setdefault(key, {
            "utilities": utils, "overlaps": 0,
            "by_tier": {"1": 0, "2": 0, "3": 0, "4": 0},
            "timeline_matches": 0, "best_distance_km": None,
            "best_overlap": None,
        })
        cell["overlaps"] += 1
        cell["by_tier"][str(r["tier"])] += 1
        if r.get("timeline_overlap"):
            cell["timeline_matches"] += 1
        d = r.get("min_distance_km")
        if d is not None and (cell["best_distance_km"] is None or d < cell["best_distance_km"]):
            cell["best_distance_km"] = round(d, 3)
            cell["best_overlap"] = r["overlap_id"]
    rows = sorted(pairs.values(), key=lambda c: -c["overlaps"])
    return {"pairs": rows, "pair_count": len(rows)}


@router.get("/nearby/{overlap_id}")
def nearby(overlap_id: str,
           radius_km: float = Query(40.0, ge=1.0, le=200.0)) -> dict:
    """Other overlaps whose midpoints sit within `radius_km` of this one's —
    the site's staging neighborhood (what a shared yard also reaches)."""
    import math
    data = _fresh("overlaps.json")
    records = data.get("overlaps") or []
    anchor = next((r for r in records if r.get("overlap_id") == overlap_id), None)
    if not anchor:
        raise HTTPException(404, f"no overlap {overlap_id!r}")
    mp = anchor.get("midpoint")
    if not mp:
        return {"overlap_id": overlap_id, "neighbors": [],
                "note": "anchor record has no midpoint"}
    ax, ay = mp[0], mp[1]
    out = []
    for r in records:
        if r.get("overlap_id") == overlap_id:
            continue
        m2 = r.get("midpoint")
        if not m2:
            continue
        p1, p2 = math.radians(ay), math.radians(m2[1])
        dlat, dlon = p2 - p1, math.radians(m2[0] - ax)
        d = 6371.0 * 2 * math.asin(math.sqrt(
            math.sin(dlat / 2) ** 2
            + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2))
        if d <= radius_km:
            out.append({
                "overlap_id": r["overlap_id"], "distance_km": round(d, 2),
                "tier": r["tier"], "utilities": r.get("utilities"),
                "timeline_overlap": r.get("timeline_overlap"),
                "shared_window": r.get("shared_window"),
            })
    out.sort(key=lambda x: x["distance_km"])
    return {
        "overlap_id": overlap_id,
        "midpoint": mp,
        "radius_km": radius_km,
        "neighbor_count": len(out),
        "neighbors": out[:60],
    }


@router.get("/brief/{overlap_id}")
def brief(overlap_id: str) -> dict:
    """Deterministic prose brief for one overlap — the same facts the
    model-backed /api/agent/brief composes, but with no LLM. Works even
    when AGENT_API_KEY is unset; frontend can prefer whichever exists."""
    records = _fresh("overlaps.json").get("overlaps") or []
    r = next((x for x in records if x.get("overlap_id") == overlap_id), None)
    if not r:
        raise HTTPException(404, f"no overlap {overlap_id!r}")
    projs = {f["properties"]["project_id"]: f["properties"]
             for f in _fresh("projects.geojson").get("features", [])}
    a, b = projs.get(r["project_a"], {}), projs.get(r["project_b"], {})
    utils = " and ".join(r.get("utilities") or ["?"])
    win = r.get("shared_window") or {}
    parts = [
        f"{r['overlap_id']}: {utils} coordination opportunity "
        f"({r.get('tier_label')}, {r.get('min_distance_km')} km at closest approach).",
        f"{a.get('name', r['project_a'])} ({a.get('utility', '?')}) "
        f"vs {b.get('name', r['project_b'])} ({b.get('utility', '?')}).",
    ]
    if r.get("timeline_overlap") and win:
        parts.append(
            f"Build windows overlap {int(win['start'])}–{int(win['end'])} — "
            "joint scheduling is feasible.")
        if r["tier"] == 1:
            parts.append("Geometries touch/cross during a shared window — "
                         "joint outage scheduling is mandatory, not optional.")
    elif r.get("timeline_adjacent") and r.get("adjacent_window"):
        aw = r["adjacent_window"]
        parts.append(
            f"Build windows are adjacent ({int(aw['start'])}–{int(aw['end'])} "
            "handoff) — a crew roll-forward opportunity, not a concurrent "
            "shared window.")
        if r["tier"] == 1:
            parts.append("Geometries touch/cross but windows never coincide — "
                         "crossing agreements needed, no joint outage.")
    else:
        parts.append("Build windows do not intersect — coordination pays off "
                     "only if schedules can be aligned.")
    imp = next((x for x in _impacts() if x.get("overlap_id") == overlap_id), None)
    if imp and (imp.get("est_savings_usd_range") or {}).get("high"):
        rng = imp["est_savings_usd_range"]
        parts.append(
            f"Estimated shared-resource savings: ${rng['low']:,.0f}–${rng['high']:,.0f} "
            f"({rng.get('basis', 'planning-level estimate')}).")
    if r.get("explanation"):
        parts.append(str(r["explanation"]))
    return {
        "overlap_id": overlap_id,
        "brief": " ".join(parts),
        "deterministic": True,
        "fields": {
            "tier": r["tier"], "min_distance_km": r["min_distance_km"],
            "timeline_overlap": r["timeline_overlap"],
            "timeline_adjacent": r.get("timeline_adjacent", False),
            "shared_window": r.get("shared_window"),
            "adjacent_window": r.get("adjacent_window"),
            "score": r.get("score"), "zone": r.get("zone"),
        },
    }


@router.get("/conflicts")
def conflicts() -> dict:
    """Must-coordinate subset: tier-1 touching + shared window, bucketed
    by season year — the joint-outage scheduling list."""
    from .conflicts import build_conflicts
    return build_conflicts(_fresh("overlaps.json"))


@router.get("/clusters")
def clusters(radius_km: float = Query(40.0, ge=5.0, le=200.0)) -> dict:
    """Staging clusters — overlap groups shareable from one crew yard
    (midpoints within `radius_km`, union-find, default the 40 km rule)."""
    return build_clusters(_fresh("overlaps.json"), radius_km)


@router.get("/summary")
def summary() -> dict:
    """Deterministic executive summary — headline numbers composed from the
    same artifacts the public API serves. No model involved; a dashboard
    header card or agent grounding can read this verbatim."""
    from .summary import build_summary
    return build_summary(_fresh("projects.geojson"), _fresh("overlaps.json"))


@router.get("/calendar")
def calendar() -> dict:
    """Coordination calendar — overlaps grouped by shared-window start year.
    Each cell lists the tier-1..4 records opening that year (score-sorted),
    giving a Gantt-like schedule view for planning joint work."""
    rows = _fresh("overlaps.json").get("overlaps", [])
    years: dict[str, list[dict]] = {}
    no_window = 0
    adjacent_only = 0
    for r in rows:
        win = r.get("shared_window") or {}
        start = win.get("start")
        if start is None or not r.get("timeline_overlap"):
            # adjacent windows have no concurrent window — they are counted
            # separately, never scheduled into a season year.
            if r.get("timeline_adjacent"):
                adjacent_only += 1
            else:
                no_window += 1
            continue
        years.setdefault(str(int(start)), []).append({
            "overlap_id": r.get("overlap_id"),
            "utilities": r.get("utilities"),
            "tier": r.get("tier"),
            "tier_label": r.get("tier_label"),
            "min_distance_km": r.get("min_distance_km"),
            "window": {"start": win.get("start"), "end": win.get("end")},
            "score": r.get("score"),
        })
    for v in years.values():
        v.sort(key=lambda x: -(x.get("score") or 0))
    return {
        "metric": "coordination_calendar",
        "by_start_year": dict(sorted(years.items())),
        "overlaps_without_window": no_window,
        "adjacent_only": adjacent_only,
        "note": ("grouped by shared-window start year — only true window "
                 "intersections are scheduled; adjacent (roll-over) windows "
                 "are counted separately, never placed in a season"),
    }
