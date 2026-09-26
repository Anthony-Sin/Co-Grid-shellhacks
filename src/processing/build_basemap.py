"""Normalize raw HIFLD GeoJSON downloads into basemap.geojson.

Raw files (data/raw/hifld/) are read-only; we emit the uniform
docs/DATA_SCHEMA.md §2 shape the frontend/API consume.

Usage: ./venv/bin/python -m src.processing.build_basemap
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "hifld"
OUT = ROOT / "data" / "processed"
CTX = ROOT / "data" / "seeds" / "context_facilities.json"

# HIFLD attribute names have shifted across releases — map candidates.
_NAME_KEYS = ("NAME", "name", "LINE_NAME", "PLANT_NAME", "SUB_NAME")
_OWNER_KEYS = ("OWNER", "owner", "OPERATOR", "UTILITY", "COMPANY")
_VOLT_KEYS = ("VOLTAGE", "voltage", "VOLT_KV", "MAX_VOLT", "VOLTAGE_KV")


def _first(props: dict, keys: tuple[str, ...], default: Any = None) -> Any:
    for k in keys:
        v = props.get(k)
        if v not in (None, "", "NOT AVAILABLE", "-999999", -999999):
            return v
    return default


def _voltage(props: dict) -> Optional[float]:
    v = _first(props, _VOLT_KEYS)
    try:
        v = float(v)
        return v if 0 < v < 1200 else None
    except (TypeError, ValueError):
        return None


def _features(src: Path) -> list[dict]:
    if not src.exists():
        print(f"  ! missing {src.name} — skipped")
        return []
    fc = json.loads(src.read_text())
    return fc.get("features", [])


def _simplify_geom(geom: dict | None, tol_deg: float) -> dict | None:
    """Display-scale simplify (shapely, preserve topology) + 5-decimal
    rounding (~1 m). Used for backdrop layers — not for distance math."""
    if not geom:
        return geom
    try:
        from shapely.geometry import shape, mapping
        g = shape(geom).simplify(tol_deg, preserve_topology=True)
        out = json.loads(json.dumps(mapping(g), separators=(",", ":"),
                                    default=lambda o: o.tolist()))
        def rnd(c):
            if isinstance(c, list) and c and isinstance(c[0], (int, float)):
                return [round(float(x), 5) for x in c]
            if isinstance(c, list):
                return [rnd(x) for x in c]
            return c
        out["coordinates"] = rnd(out.get("coordinates"))
        return out
    except Exception:
        return geom


def _round_geom(geom: dict | None) -> dict | None:
    """5-decimal (~1 m) coordinate rounding — halves JSON size, no visual loss."""
    if not geom:
        return geom
    def rnd(c):
        if isinstance(c, list) and c and isinstance(c[0], (int, float)):
            return [round(float(x), 5) for x in c]
        if isinstance(c, list):
            return [rnd(x) for x in c]
        return c
    return {**geom, "coordinates": rnd(geom.get("coordinates"))}


def _emit(feats: list[dict], layer: str, extra=None,
          simplify_tol: float = 0.0) -> list[dict]:
    out = []
    for f in feats:
        props = f.get("properties") or {}
        geom = f.get("geometry")
        if simplify_tol:
            geom = _simplify_geom(geom, simplify_tol)
        else:
            geom = _round_geom(geom)
        item = {
            "type": "Feature",
            "properties": {
                "layer": layer,
                "name": str(_first(props, _NAME_KEYS, "unnamed")),
                "owner": str(_first(props, _OWNER_KEYS, "unknown")),
                "voltage_kv": _voltage(props),
                "source": "HIFLD",
            },
            "geometry": geom,
        }
        if extra:
            item["properties"].update(extra(props))
        if item["geometry"]:
            out.append(item)
    return out


def main() -> None:
    feats: list[dict] = []
    feats += _emit(_features(RAW / "transmission_lines.geojson"), "existing_transmission_line")
    feats += _emit(_features(RAW / "substations.geojson"), "existing_substation")
    feats += _emit(
        _features(RAW / "power_plants.geojson"),
        "existing_power_plant",
        extra=lambda p: {
            "fuel": _first(p, ("PRIM_FUEL", "prim_fuel", "FUEL", "PRIMARY_FUEL")),
            "capacity_mw": _first(p, ("CAPACITY", "capacity", "TOTAL_CAP", "NAMEPLATE")),
        },
    )
    feats += _emit(
        _features(RAW / "service_territories.geojson"),
        "service_territory",
        # ~500 m tolerance — backdrop polygons; statewide file is ~28 MB raw
        simplify_tol=0.005,
    )

    # Documented existing cross-border ties (see data/seeds/context_facilities.json)
    if CTX.exists():
        for t in json.loads(CTX.read_text()).get("facilities", []):
            feats.append({
                "type": "Feature",
                "properties": {
                    "layer": "existing_tie_documented",
                    "name": t["name"],
                    "owner": t.get("owner", "unknown"),
                    "voltage_kv": t.get("voltage_kv"),
                    "source": t.get("source", "public filing"),
                },
                "geometry": {"type": "LineString", "coordinates": t["line"]},
            })

    fc = {"type": "FeatureCollection", "source": "HIFLD + documented filings", "features": feats}
    out = OUT / "basemap.geojson"
    out.write_text(json.dumps(fc))
    counts: dict[str, int] = {}
    for f in feats:
        counts[f["properties"]["layer"]] = counts.get(f["properties"]["layer"], 0) + 1
    print(f"basemap.geojson: {counts} ({out.stat().st_size//1024} KB)")


if __name__ == "__main__":
    main()
