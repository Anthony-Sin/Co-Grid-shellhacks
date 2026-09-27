"""Data-access tools — load processed artifacts and answer record questions.

Each tool reads ONLY from data/processed artifacts (the same files the
public API serves). No network, no mutation, no fabricated data. Results
are compact dicts/lists tuned for small-model consumption — trimmed
fields, bounded list lengths, explicit nulls for missing values.
"""
from __future__ import annotations

import json
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

from src.analysis.filters import filter_records
from src.processing.projection import scene_for_zone as _scene_for_zone

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "processed"


def re_alnum_tokens(s: str) -> list[str]:
    """Uppercased alphanumeric tokens of a raw string — the same
    normalization family as the gazetteer's `norm` field, but split on
    punctuation/space so 'Plant Vogtle' -> ['PLANT', 'VOGTLE']."""
    s = unicodedata.normalize("NFKD", str(s)).upper()
    out, cur = [], []
    for c in s:
        if c.isalnum():
            cur.append(c)
        elif cur:
            out.append("".join(cur))
            cur = []
    if cur:
        out.append("".join(cur))
    return out


@lru_cache(maxsize=16)
def _cached(name: str, mtime: float) -> Any:  # noqa: ARG001 — mtime busts cache
    return json.loads((PROCESSED / name).read_text())


def load_processed(name: str) -> Any:
    p = PROCESSED / name
    if not p.exists():
        raise FileNotFoundError(f"{name} missing — run scripts/pipeline.sh")
    return _cached(name, p.stat().st_mtime)


def projects() -> list[dict]:
    return load_processed("projects.geojson").get("features", [])


def overlaps() -> list[dict]:
    return load_processed("overlaps.json").get("overlaps", [])


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
        "timeline_adjacent": r.get("timeline_adjacent"),
        "shared_window": r.get("shared_window"),
        "adjacent_window": r.get("adjacent_window"),
        "score": r.get("score"),
        "zone": r.get("zone"),
        "deep_link": (
            f"/?scene={_scene_for_zone(r.get('zone'))}"
            f"&select={r.get('overlap_id')}&panel=0"
        ),
    }


# --------------------------------------------------------------------- tools


def tool_stats() -> dict:
    """Dataset-wide counts: projects by utility, overlaps by tier."""
    projs, ovs = projects(), overlaps()
    by_util: dict[str, int] = {}
    by_tier: dict[str, int] = {}
    zones: set[str] = set()
    for f in projs:
        u = f["properties"].get("utility", "?")
        by_util[u] = by_util.get(u, 0) + 1
        zones.update(f["properties"].get("zones") or [])
    for o in ovs:
        t = str(o["tier"])
        by_tier[t] = by_tier.get(t, 0) + 1
    return {
        "projects": len(projs),
        "by_utility": by_util,
        "overlaps": len(ovs),
        "by_tier": by_tier,
        "timeline_matches": sum(1 for o in ovs if o["timeline_overlap"]),
        "timeline_adjacent": sum(1 for o in ovs if o.get("timeline_adjacent")),
        "zones_available": sorted(zones),
    }


def tool_list_projects(utility: str | None = None, zone: str | None = None,
                       source: str | None = None, limit: int = 30) -> dict:
    """List planned projects, optionally filtered by utility, zone tag, or
    a substring of the provenance `source` (e.g. an IRP/filing name)."""
    feats = projects()
    if utility:
        feats = [f for f in feats if f["properties"].get("utility") == utility]
    if zone:
        feats = [f for f in feats if zone in (f["properties"].get("zones") or [])]
    if source:
        s = str(source).strip().lower()
        feats = [f for f in feats
                 if s in (f["properties"].get("source") or "").lower()]
    return {
        "count": len(feats),
        "shown": min(len(feats), limit),
        "projects": [_proj_props(f) for f in feats[:limit]],
    }


def tool_get_project(project_id: str) -> dict:
    """Full record for one project (geometry summary + all properties)."""
    for f in projects():
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
    rows = overlaps()
    if tier is not None:
        rows = [r for r in rows if r["tier"] == tier]
    if timeline_only:
        rows = [r for r in rows if r["timeline_overlap"]]
    rows = sorted(rows, key=lambda r: r.get("score", 0), reverse=True)[: max(1, min(n, 50))]
    return {"shown": len(rows), "overlaps": [_overlap_brief(r) for r in rows]}


def _overlap_detail(r: dict) -> dict:
    # resolve member ids to name/utility/source so a single get_overlap
    # call can fully cite an opportunity — no extra get_project rounds.
    by_id = {f["properties"].get("project_id"): f["properties"]
             for f in projects()}
    members = []
    for pid in (r.get("project_a"), r.get("project_b")):
        p = by_id.get(pid) or {}
        members.append({
            "project_id": pid,
            "name": p.get("name"),
            "utility": p.get("utility"),
            "voltage_kv": p.get("voltage_kv"),
            "window": {"start_year": p.get("start_year"),
                       "end_year": p.get("end_year")},
            "source": p.get("source"),
        })
    return {
        **_overlap_brief(r),
        "members": members,
        "closest_point_a": r.get("closest_point_a"),
        "closest_point_b": r.get("closest_point_b"),
        "midpoint": r.get("midpoint"),
        "explanation": r.get("explanation"),
        "cost": r.get("cost"),
    }


def tool_get_overlap(overlap_id: str | None = None,
                     overlap_ids: list | None = None) -> dict:
    """Full detail for one overlap: closest points, shared window, zone size.

    Pass `overlap_ids` (list, <=30) to fetch several records in ONE call —
    a multi-record question should never burn a round per lookup."""
    if overlap_ids is not None:
        # tolerate a comma-joined OR JSON-array string — models sometimes
        # emit '["OV-1","OV-2"]' even when the spec says array
        if isinstance(overlap_ids, str):
            s = overlap_ids.strip()
            if s.startswith("["):
                try:
                    overlap_ids = json.loads(s)
                except ValueError:
                    overlap_ids = s
            if isinstance(overlap_ids, str):
                overlap_ids = [x.strip() for x in s.split(",") if x.strip()]
        if not isinstance(overlap_ids, list) or not overlap_ids:
            return {"error": "overlap_ids must be a non-empty list"}
        wanted = [str(x) for x in overlap_ids[:30]]
        by_id = {r.get("overlap_id"): r for r in overlaps()}
        found = [_overlap_detail(by_id[i]) for i in wanted if i in by_id]
        missing = [i for i in wanted if i not in by_id]
        return {"found": len(found), "overlaps": found, "missing": missing}
    if not overlap_id:
        return {"error": "provide overlap_id (one record) or overlap_ids (batch)"}
    for r in overlaps():
        if r.get("overlap_id") == overlap_id:
            return _overlap_detail(r)
    return {"error": f"no overlap '{overlap_id}'"}


def tool_find_overlaps(utility: str | None = None,
                       utilities: str | list | None = None,
                       tier: int | None = None,
                       zone: str | None = None,
                       state: str | None = None,
                       timeline_only: bool = False,
                       adjacent_only: bool = False,
                       missing_dates: bool = False,
                       sort: str | None = None,
                       offset: int = 0,
                       limit: int = 25) -> dict:
    """Filtered overlap search — the record-level query primitive.

    `utility` matches either side ("GPC"); `utilities` restricts to an
    exact pair ("GPC,DESC" or ["GPC","DESC"]). `zone` is a substring
    match on the record's zone label (incl. 'a / b' composites).
    `timeline_only` keeps true window intersections; `adjacent_only`
    keeps the end-to-start handoff records instead (a different
    coordination class — never both). Default order is engine rank
    (tier asc -> distance asc); `sort="distance"`/`"distance_desc"`
    orders by closest-point km instead — the only way to reach the
    FARTHEST gaps (rank order puts them last)."""
    try:
        rows = filter_records(
            overlaps(), utility=utility, utilities=utilities, tier=tier,
            zone=zone, state=state, timeline_only=timeline_only,
            adjacent_only=adjacent_only, missing_dates=missing_dates)
    except ValueError as e:
        return {"error": str(e)}
    if sort:
        s = sort.strip().lower()
        # missing distances sort last in both directions — a record with
        # no km is never the answer to "closest" or "farthest"
        if s in ("distance", "distance_asc"):
            rows = sorted(rows, key=lambda r: r.get("min_distance_km") if r.get("min_distance_km") is not None else 1e9)
        elif s in ("distance_desc", "farthest"):
            rows = sorted(rows, key=lambda r: r.get("min_distance_km") if r.get("min_distance_km") is not None else -1e9, reverse=True)
        elif s != "rank":
            return {"error": f"unknown sort '{sort}' — rank|distance|distance_desc"}
    lim = max(1, min(int(limit or 25), 50))
    off = max(0, int(offset or 0))
    page = rows[off:off + lim]
    # download link mirrors this exact filter set — /api/overlaps.csv
    # shares filter_records so the export is faithful to this result.
    qs: dict[str, Any] = {}
    if utility:
        qs["utility"] = utility
    if utilities:
        qs["utilities"] = (",".join(utilities) if isinstance(utilities, list)
                           else utilities)
    if tier is not None:
        qs["tier"] = int(tier)
    if zone:
        qs["zone"] = zone
    if state:
        qs["state"] = state
    if timeline_only:
        qs["timeline_only"] = "true"
    if adjacent_only:
        qs["adjacent_only"] = "true"
    if missing_dates:
        qs["missing_dates"] = "true"
    if sort and sort.strip().lower() != "rank":
        qs["sort"] = sort.strip().lower()
    return {
        "total_matching": len(rows),
        "shown": len(page),
        "offset": off,
        "overlaps": [_overlap_brief(r) for r in page],
        "csv_export": (f"/api/overlaps.csv?{urlencode(qs)}" if qs
                       else "/api/overlaps.csv"),
    }


def tool_no_overlap_reason(project_id: str) -> dict:
    """Honest diagnosis when a project has zero coordination records:
    nearest same-utility neighbor (excluded by rule), nearest cross-
    utility project + its closest-point distance (the only reason that
    matters — overlaps are geometry-first). Uses the same LCC projected
    distance as the engine — never centroid guesses."""
    pid = (project_id or "").strip()
    feats = {f["properties"].get("project_id"): f for f in projects()}
    anchor = feats.get(pid)
    if not anchor:
        return {"error": f"no project '{project_id}'"}
    have = sum(1 for r in overlaps()
               if r.get("project_a") == pid or r.get("project_b") == pid)
    props = anchor["properties"]
    if have:
        return {"project_id": pid, "overlap_records": have,
                "reason": "project HAS coordination records — "
                          "see project_overlaps for its portfolio"}
    if not anchor.get("geometry"):
        return {"project_id": pid, "overlap_records": 0,
                "reason": "project has no geometry — it cannot enter "
                          "overlap detection at all"}
    from pyproj import Transformer
    from shapely.geometry import shape
    from shapely.ops import transform as shp_transform
    from src.spatial.crs import SOURCE_CRS, TARGET_CRS
    to_m = Transformer.from_crs(SOURCE_CRS, TARGET_CRS, always_xy=True)
    g0 = shp_transform(to_m.transform, shape(anchor["geometry"]))
    own = props.get("utility")
    nearest_same = nearest_cross = None
    for f in projects():
        p = f["properties"]
        if p.get("project_id") == pid or not f.get("geometry"):
            continue
        try:
            d = shp_transform(to_m.transform,
                              shape(f["geometry"])).distance(g0) / 1000.0
        except Exception:
            continue
        entry = {"project_id": p.get("project_id"), "name": p.get("name"),
                 "utility": p.get("utility"), "distance_km": round(d, 1)}
        if p.get("utility") == own:
            if nearest_same is None or d < nearest_same["distance_km"]:
                nearest_same = entry
        elif nearest_cross is None or d < nearest_cross["distance_km"]:
            nearest_cross = entry
    reason = None
    if nearest_cross and nearest_cross["distance_km"] <= 40.0:
        reason = ("nearest cross-utility project is inside 40 km but no "
                  "record exists — check whether it is the same physical "
                  "project filed by both parties (dedup) or flagged data")
    elif nearest_cross:
        reason = (f"nearest cross-utility project is "
                  f"{nearest_cross['distance_km']} km away — outside the "
                  f"40 km coordination radius, so no record can exist")
    else:
        reason = "no other utility's projects exist to compare against"
    return {
        "project_id": pid, "utility": own, "overlap_records": 0,
        "nearest_cross_utility": nearest_cross,
        "nearest_same_utility": nearest_same,
        "reason": reason,
        "note": ("same-utility proximity never produces a record — "
                 "overlaps are cross-utility by rule"),
    }


def tool_project_overlaps(project_id: str) -> dict:
    """Every coordination record touching one project — its full
    coordination portfolio, in engine rank order."""
    pid = (project_id or "").strip()
    if not pid:
        return {"error": "project_id required"}
    rows = [r for r in overlaps()
            if r.get("project_a") == pid or r.get("project_b") == pid]
    if not rows:
        return {"project_id": pid, "overlap_count": 0, "overlaps": [],
                "note": "project has no cross-utility overlaps within 40 km"}
    return {
        "project_id": pid,
        "overlap_count": len(rows),
        "tiers": {str(t): sum(1 for r in rows if r["tier"] == t) for t in (1, 2, 3, 4)},
        "overlaps": [{
            **_overlap_brief(r),
            # the OTHER side of the pair — never mutate the cached record
            "against": (r.get("project_b") if r.get("project_a") == pid
                        else r.get("project_a")),
        } for r in rows[:40]],
    }


def tool_projects_near(lon: float, lat: float, km: float = 25) -> dict:
    """Planned projects whose GEOMETRY passes within `km` of a point —
    distance to the nearest point on the line/polygon, not just vertices
    (a straight endpoint-only line is found mid-segment)."""
    from pyproj import Transformer
    from shapely.geometry import Point, shape
    from shapely.ops import transform as shp_transform

    from src.spatial.crs import SOURCE_CRS, TARGET_CRS

    to_m = Transformer.from_crs(SOURCE_CRS, TARGET_CRS, always_xy=True)
    pt_m = shp_transform(to_m.transform, Point(lon, lat))
    km = max(1.0, min(km, 200.0))
    hits = []
    for f in projects():
        geom = f.get("geometry")
        if not geom:
            continue
        try:
            g_m = shp_transform(to_m.transform, shape(geom))
        except Exception:
            continue
        d = g_m.distance(pt_m) / 1000.0
        if d <= km:
            hits.append({**_proj_props(f), "distance_km": round(d, 2)})
    hits.sort(key=lambda h: h["distance_km"])
    return {"center": [lon, lat], "radius_km": km, "count": len(hits), "projects": hits[:30]}


def tool_gazetteer(name: str, limit: int = 10) -> dict:
    """Fuzzy-lookup real facilities (substations/plants) by name — resolves
    WHERE a filed project sits when the record only names a substation."""
    try:
        gaz = load_processed("gazetteer.json")
    except FileNotFoundError:
        return {"error": "gazetteer.json missing — run the gazetteer build"}
    # Normalize the query exactly like entries were indexed (NFKD, upper,
    # alnum-only). Entries store `norm` = name stripped of non-alphanumerics,
    # so a longer query ("PLANTVOGTLE") contains the entry's norm
    # ("VOGTLE") — substring checks run BOTH directions. Only when that
    # yields nothing do we fall back to individual >=4-char tokens
    # (shorter tokens like "NOT" substring-match too loosely).
    q = unicodedata.normalize("NFKD", (name or "").upper())
    q = "".join(c for c in q if c.isalnum())
    if not q:
        return {"error": "name required"}
    scored = []
    for e in gaz:
        n = e.get("norm") or ""
        if q in n or n in q:
            score = min(len(q), len(n)) / max(len(q), len(n), 1)
            scored.append((score, e))
    if not scored:
        tokens = {t for t in re_alnum_tokens(name or "") if len(t) >= 4}
        for e in gaz:
            n = e.get("norm") or ""
            if tokens and any(t in n for t in tokens):
                score = max(len(t) for t in tokens if t in n) / max(len(n), 1)
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


def tool_data_health() -> dict:
    """Honest quality report: missing dates, location confidence, provenance —
    so the agent can answer 'how good is this data' without guessing."""
    projs = projects()
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
            u = urlparse(s.split(" ")[0])
            stem = u.path.rsplit("/", 1)[-1].replace(".pdf", "")[:48]
            s = f"{u.netloc} → {stem}" if stem else u.netloc
        src_counts[s] = src_counts.get(s, 0) + 1
        k = p.get("kind") or "unknown"
        kind_counts[k] = kind_counts.get(k, 0) + 1
    ovs = overlaps()
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
            "adjacent_windows": sum(1 for o in ovs if o.get("timeline_adjacent")),
            "without_timeline": sum(
                1 for o in ovs
                if not o["timeline_overlap"] and not o.get("timeline_adjacent")),
        },
    }
