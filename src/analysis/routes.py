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


@router.get("/calendar")
def calendar() -> dict:
    """Coordination calendar — overlaps grouped by shared-window start year.
    Each cell lists the tier-1..4 records opening that year (score-sorted),
    giving a Gantt-like schedule view for planning joint work."""
    rows = _fresh("overlaps.json").get("overlaps", [])
    years: dict[str, list[dict]] = {}
    no_window = 0
    for r in rows:
        win = r.get("shared_window") or {}
        start = win.get("start")
        if start is None or not r.get("timeline_overlap"):
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
        "note": ("grouped by shared-window start year; overlaps lacking a "
                 "timeline match are counted but not scheduled"),
    }
