"""Build the facilities gazetteer — named power facilities -> WGS84 coords.

Sources (all real, read-only raw): HIFLD power plants + substations, OSM
power=substation/switch/plant/generator features. Output:
data/processed/gazetteer.json — consumed by build_projects.py.

Usage: ./venv/bin/python -m src.processing.build_gazetteer
"""
from __future__ import annotations

import json
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).upper()
    return "".join(c for c in s if c.isalnum())


def entries() -> list[dict]:
    out: list[dict] = []

    for layer, fname in (("plant", "power_plants.geojson"), ("substation", "substations.geojson")):
        path = RAW / "hifld" / fname
        if not path.exists():
            continue
        for f in json.loads(path.read_text()).get("features", []):
            p = f.get("properties") or {}
            name = p.get("NAME") or p.get("PLANT_NAME")
            g = f.get("geometry") or {}
            if not name or g.get("type") != "Point":
                continue
            lon, lat = g["coordinates"][:2]
            out.append({"name": str(name), "norm": norm(name), "layer": layer,
                        "lon": lon, "lat": lat, "src": "hifld"})

    p_infra = RAW / "osm" / "power_infra.json"
    if p_infra.exists():
        for e in json.loads(p_infra.read_text()).get("elements", []):
            t = e.get("tags", {})
            name = t.get("name")
            if not name:
                continue
            c = e.get("center") or {}
            lon = e.get("lon", c.get("lon"))
            lat = e.get("lat", c.get("lat"))
            if lon is None or lat is None:
                continue
            out.append({"name": name, "norm": norm(name),
                        "layer": t.get("power", "substation"),
                        "lon": lon, "lat": lat,
                        "operator": t.get("operator", ""), "src": "osm"})
    return out


def main() -> None:
    es = entries()
    (OUT / "gazetteer.json").write_text(json.dumps(es, indent=1))
    print(f"gazetteer.json: {len(es)} named facilities "
          f"({sum(1 for e in es if e['src']=='osm')} osm / {sum(1 for e in es if e['src']=='hifld')} hifld)")


if __name__ == "__main__":
    main()
