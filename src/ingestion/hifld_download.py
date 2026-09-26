"""Download HIFLD electric grid GIS layers for the GA/SC study region.

Pulls public (no-API-key) data from the official HIFLD ArcGIS Online org
(org id HDRa0B57OVrv2E1q, backing https://hifld-geoplatform.hub.arcgis.com)
as GeoJSON FeatureCollections clipped to a selectable envelope:

* ``statewide`` (default) — all of Georgia + South Carolina; the canonical
  dataset committed under data/raw/hifld/ (a strict superset of the old
  corridor pull, so downstream code stays compatible).
* ``corridor`` — the original Savannah/Augusta two-city envelope.

After each layer is paged down, the downloaded feature count is verified
against the server's own ``returnCountOnly`` envelope query and both
numbers are printed.

Run:
    ./venv/bin/python -m src.ingestion.hifld_download [--bbox statewide|corridor]
    ./venv/bin/python src/ingestion/hifld_download.py --bbox statewide

Output (raw, read-only):
    data/raw/hifld/transmission_lines.geojson
    data/raw/hifld/substations.geojson
    data/raw/hifld/power_plants.geojson
    data/raw/hifld/service_territories.geojson
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE = "https://services5.arcgis.com/HDRa0B57OVrv2E1q/arcgis/rest/services"

# Named envelopes (WGS84 lon/lat, EPSG:4326).
CORRIDOR_BBOX = {  # original Savannah + Augusta GA/SC corridor
    "min_lon": -82.40,
    "min_lat": 31.85,
    "max_lon": -80.60,
    "max_lat": 33.75,
}
STATEWIDE_BBOX = {  # all of Georgia + South Carolina
    "min_lon": -85.70,
    "min_lat": 30.30,
    "max_lon": -78.00,
    "max_lat": 35.25,
}
BBOXES = {"corridor": CORRIDOR_BBOX, "statewide": STATEWIDE_BBOX}

# filename -> FeatureServer layer URL (layer 0 of each HIFLD service).
LAYERS = {
    "transmission_lines.geojson": (
        f"{BASE}/Electric_Power_Transmission_Lines/FeatureServer/0"
    ),
    "substations.geojson": f"{BASE}/Electric_Substations/FeatureServer/0",
    "power_plants.geojson": f"{BASE}/Power_Plants/FeatureServer/0",
    "service_territories.geojson": (
        f"{BASE}/Electric_Retail_Service_Territories/FeatureServer/0"
    ),
}

OUT_DIR = Path(__file__).resolve().parents[2] / "data" / "raw" / "hifld"

PAGE_SIZE = 2000            # matches service maxRecordCount
MAX_RETRIES = 5
BACKOFF_BASE_S = 2.0        # exponential backoff: 2,4,8,16,32 s
REQUEST_TIMEOUT_S = 120

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
)
log = logging.getLogger("hifld_download")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_json(url: str, params: dict) -> dict:
    """GET url with retries + exponential backoff; return parsed JSON."""
    last_exc: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT_S)
            if resp.status_code >= 500:
                raise requests.HTTPError(
                    f"HTTP {resp.status_code}", response=resp
                )
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict) and data.get("error"):
                err = data["error"]
                # 5xx-coded ArcGIS errors are worth retrying too.
                if err.get("code", 0) >= 500:
                    raise requests.HTTPError(f"ArcGIS error {err}")
                raise RuntimeError(f"ArcGIS error: {err}")
            return data
        except Exception as exc:  # noqa: BLE001 - retry everything transient
            last_exc = exc
            wait = BACKOFF_BASE_S ** attempt
            log.warning(
                "attempt %d/%d failed (%s); retrying in %.0fs",
                attempt, MAX_RETRIES, exc, wait,
            )
            time.sleep(wait)
    raise RuntimeError(
        f"query failed after {MAX_RETRIES} attempts: {last_exc}"
    )


def _envelope_params(bbox: dict) -> dict:
    """Shared intersects-envelope query params for a bbox dict."""
    envelope = (
        f"{bbox['min_lon']},{bbox['min_lat']},"
        f"{bbox['max_lon']},{bbox['max_lat']}"
    )
    return {
        "where": "1=1",
        "geometry": envelope,
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
    }


def query_count(layer_url: str, bbox: dict) -> int:
    """Server-side feature count for the same envelope (returnCountOnly)."""
    params = {
        **_envelope_params(bbox),
        "returnCountOnly": "true",
        "f": "json",
    }
    data = _get_json(f"{layer_url}/query", params)
    return int(data.get("count", -1))


def query_layer(layer_url: str, bbox: dict) -> dict:
    """Fetch all features of one layer inside `bbox` as a GeoJSON FC."""
    params = {
        **_envelope_params(bbox),
        "outFields": "*",
        "outSR": 4326,
        "orderByFields": "OBJECTID_1",
        "resultRecordCount": PAGE_SIZE,
        "f": "geojson",
    }

    features: list[dict] = []
    offset = 0
    while True:
        params["resultOffset"] = offset
        page = _get_json(f"{layer_url}/query", params)
        feats = page.get("features", [])
        features.extend(feats)
        log.info(
            "  fetched %d features (total so far %d)", len(feats), len(features)
        )
        exceeded = (page.get("properties") or {}).get(
            "exceededTransferLimit", False
        )
        if not exceeded or not feats:
            break
        offset += len(feats)

    return {
        "type": "FeatureCollection",
        "metadata": {
            "source_url": layer_url,
            "bbox": bbox,
            "feature_count": len(features),
        },
        "features": features,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--bbox",
        choices=sorted(BBOXES),
        default="statewide",
        help="envelope to clip layers to (default: statewide)",
    )
    args = parser.parse_args()
    bbox = BBOXES[args.bbox]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    log.info("envelope '%s': %s", args.bbox, bbox)
    summary: dict[str, int] = {}
    for filename, layer_url in LAYERS.items():
        log.info("downloading %s <- %s", filename, layer_url)
        expected = query_count(layer_url, bbox)
        log.info("  server returnCountOnly: %d features", expected)
        fc = query_layer(layer_url, bbox)
        n = len(fc["features"])
        if n == 0:
            log.warning("  %s returned ZERO features!", filename)
        if expected >= 0 and n != expected:
            log.warning(
                "  COUNT MISMATCH: downloaded %d but server reports %d",
                n, expected,
            )
        out_path = OUT_DIR / filename
        out_path.write_text(json.dumps(fc), encoding="utf-8")
        log.info(
            "  wrote %s (downloaded %d / server count %d)",
            out_path, n, expected,
        )
        summary[filename] = n
    log.info("done: %s", summary)


if __name__ == "__main__":
    main()
