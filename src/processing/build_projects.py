"""Build projects.geojson from the curated seed file + real HIFLD anchors.

Seed file: data/seeds/projects_seed_statewide.json — the curated GA+SC
statewide superset (283 filed projects; projects_seed.json's 73 corridor
records are its first 73). Authored ONLY from public filings
(SCRTP/SERTP, GA/SC PSC dockets, IRPs). Each record supplies either
explicit WGS84 geometry or named facilities resolved against downloaded
HIFLD power plants / substations. Unresolvable names => hard error, never
fabricated coordinates (AGENTS.md §7).

Seed record shape:
{
  "project_id": "GPC-MCINTOSH-CT",
  "utility": "GPC",
  "name": "Plant McIntosh combined-cycle expansion",
  "kind": "plant",
  "voltage_kv": 500,
  "start_year": 2026, "end_year": 2029,
  "status": "planned",
  "location_confidence": "verified",
  "source": "https://... filing URL",
  "notes": "...",
  "zones": ["savannah"],
  // one of:
  "point":      [lon, lat],
  "line":       [[lon,lat], ...],
  "facility":   "MCINTOSH",                 // resolved in HIFLD plants/subs
  "endpoints":  ["THOMSON PRIMARY", "VOGTLE"],   // straight line between them
}

Usage: ./venv/bin/python -m src.processing.build_projects [seed_file]
"""
from __future__ import annotations

import json
import sys
import unicodedata
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "hifld"
SEED_DIR = ROOT / "data" / "seeds"
SEEDS = SEED_DIR / "projects_seed_statewide.json"
OUT = ROOT / "data" / "processed"

_NAME_KEYS = ("NAME", "name", "PLANT_NAME", "SUB_NAME")
GAZETTEER = ROOT / "data" / "processed" / "gazetteer.json"


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).upper()
    return "".join(c for c in s if c.isalnum())


def _facility_index() -> list[tuple[str, str, float, float]]:
    """[(norm_name, layer, lon, lat)] — gazetteer.json if built, else HIFLD."""
    if GAZETTEER.exists():
        return [
            (e["norm"], e["layer"], e["lon"], e["lat"])
            for e in json.loads(GAZETTEER.read_text())
        ]
    idx = []
    for fname, layer in (("power_plants.geojson", "plant"), ("substations.geojson", "substation")):
        path = RAW / fname
        if not path.exists():
            continue
        for f in json.loads(path.read_text()).get("features", []):
            props = f.get("properties") or {}
            name = next((props[k] for k in _NAME_KEYS if props.get(k)), None)
            geom = f.get("geometry") or {}
            if not name or geom.get("type") != "Point":
                continue
            lon, lat = geom["coordinates"][:2]
            idx.append((_norm(name), layer, lon, lat))
    return idx


def resolve_facility(name: str, index: list[tuple[str, str, float, float]]) -> tuple[float, float]:
    """Exact-normalized match, else unique substring match, else error."""
    target = _norm(name)
    exact = [r for r in index if r[0] == target]
    if exact:
        return exact[0][2], exact[0][3]
    subs = [r for r in index if target in r[0] or r[0] in target]
    uniq = {(r[2], r[3]) for r in subs}
    if len(uniq) == 1:
        return next(iter(uniq))
    raise KeyError(
        f"cannot resolve facility '{name}' "
        f"({'ambiguous: '+str(sorted(uniq)) if uniq else 'no match in gazetteer/HIFLD'})"
    )


def build_geometry(seed: dict, index) -> tuple[dict, str]:
    """Return (geojson geometry, confidence_note) per priority."""
    if "point" in seed:
        return {"type": "Point", "coordinates": seed["point"]}, "explicit point"
    if "line" in seed:
        return {"type": "LineString", "coordinates": seed["line"]}, "explicit line"
    if "facility" in seed:
        lon, lat = resolve_facility(seed["facility"], index)
        return {"type": "Point", "coordinates": [lon, lat]}, f"HIFLD '{seed['facility']}'"
    if "endpoints" in seed:
        pts = [list(resolve_facility(e, index)) for e in seed["endpoints"]]
        return {"type": "LineString", "coordinates": pts}, "endpoint straight-line"
    raise ValueError(f"{seed.get('project_id')}: no geometry spec")


def main() -> int:
    seed_path = SEED_DIR / sys.argv[1] if len(sys.argv) > 1 else SEEDS
    seeds = json.loads(seed_path.read_text())["projects"]
    index = _facility_index()
    feats, errors = [], []
    for s in seeds:
        try:
            geom, how = build_geometry(s, index)
        except (KeyError, ValueError) as e:
            errors.append(str(e))
            continue
        props = {k: s[k] for k in (
            "project_id", "utility", "name", "kind", "voltage_kv",
            "start_year", "end_year", "status", "location_confidence",
            "source", "notes", "zones",
        ) if k in s}
        props.setdefault("location_confidence", "approximate")
        props["geometry_basis"] = how
        feats.append({"type": "Feature", "properties": props, "geometry": geom})

    fc = {"type": "FeatureCollection", "source": "public filings + HIFLD anchors",
          "features": feats}
    out = OUT / "projects.geojson"
    out.write_text(json.dumps(fc, indent=1))
    print(f"projects.geojson: {len(feats)} features")
    for e in errors:
        print(f"  !! {e}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
