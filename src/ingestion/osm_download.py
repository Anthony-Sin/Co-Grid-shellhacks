#!/usr/bin/env python3
"""Download raw OpenStreetMap data for the Gridlock Challenge city scenes.

Fetches buildings, roads, water, and green-space features from the public
Overpass API for the Savannah and Augusta study regions (bounding boxes from
``docs/DATA_SCHEMA.md``) and saves the *unmodified* Overpass JSON response
bodies to ``data/raw/osm/``.

No API key required. Uses the primary Overpass endpoint with the
overpass.kumi.systems mirror as fallback on HTTP 429 / timeouts, sleeps
between requests, and retries each query with exponential backoff.

Usage:
    ./venv/bin/python src/ingestion/osm_download.py

Outputs (exact Overpass response bodies, one per region/group):
    data/raw/osm/savannah_buildings.json
    data/raw/osm/savannah_roads.json
    data/raw/osm/savannah_water.json
    data/raw/osm/savannah_green.json
    data/raw/osm/augusta_buildings.json
    data/raw/osm/augusta_roads.json
    data/raw/osm/augusta_water.json
    data/raw/osm/augusta_green.json
"""

import json
import sys
import time
from pathlib import Path

import requests

# --- configuration ---------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "data" / "raw" / "osm"

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",  # fallback mirror
]

# WGS84 bounding boxes, Overpass order: (south, west, north, east)
# i.e. (min_lat, min_lon, max_lat, max_lon) -- from docs/DATA_SCHEMA.md.
BBOXES = {
    "savannah": (31.95, -81.55, 32.45, -80.75),
    "augusta": (33.25, -82.30, 33.65, -81.60),
}

SERVER_TIMEOUT = 240        # Overpass [timeout:N] -- seconds the server may work
REQUEST_TIMEOUT = 300       # client-side HTTP timeout (must exceed server timeout)
MAX_ATTEMPTS = 4            # total attempts per query (each may hit primary+mirror)
BACKOFF_BASE_S = 10         # exponential backoff: BASE * 2**(attempt-1)
SLEEP_BETWEEN_REQUESTS_S = 5

# One Overpass QL template per feature group. `out geom;` makes ways carry
# their full node geometry so no separate node lookup is needed downstream.
QUERY_TEMPLATES = {
    "buildings": """[out:json][timeout:{timeout}];
(
  way["building"]({bbox});
  relation["building"]({bbox});
);
out geom;
""",
    "roads": """[out:json][timeout:{timeout}];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|residential|service|unclassified)$"]({bbox});
  way["railway"="rail"]({bbox});
);
out geom;
""",
    "water": """[out:json][timeout:{timeout}];
(
  way["natural"="water"]({bbox});
  way["waterway"]({bbox});
  way["natural"="coastline"]({bbox});
  relation["natural"="water"]({bbox});
);
out geom;
""",
    "green": """[out:json][timeout:{timeout}];
(
  way["leisure"~"^(park|garden|golf_course|nature_reserve)$"]({bbox});
  way["landuse"~"^(forest|grass|meadow|recreation_ground|cemetery)$"]({bbox});
  way["natural"~"^(wood|scrub|wetland|grassland|beach|sand)$"]({bbox});
);
out geom;
""",
}

# --- helpers ---------------------------------------------------------------


def _remark_is_error(remark: str) -> bool:
    """Detect Overpass 'remark' fields that indicate query failure/timeout."""
    r = remark.lower()
    return "error" in r or "timed out" in r or "too many requests" in r


def _post_once(endpoint: str, query: str, label: str) -> bytes:
    """POST one Overpass query. Returns raw response body bytes.

    Raises RuntimeError for non-retryable failures, _Retryable for
    rate-limit/timeout/server problems.
    """

    class Retryable(Exception):
        pass

    try:
        resp = requests.post(
            endpoint,
            data={"data": query},
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": "gridlock-shellhacks-osm-ingestion/1.0"},
        )
    except requests.RequestException as exc:
        raise Retryable(f"{endpoint}: connection error: {exc}") from exc

    if resp.status_code == 200:
        # Overpass can return HTTP 200 with an error 'remark' (e.g. timeout).
        try:
            parsed = json.loads(resp.content)
        except json.JSONDecodeError as exc:
            raise Retryable(f"{endpoint}: invalid JSON body: {exc}") from exc
        remark = parsed.get("remark", "")
        if remark and _remark_is_error(remark):
            raise Retryable(f"{endpoint}: overpass remark: {remark}")
        if "elements" not in parsed:
            raise Retryable(f"{endpoint}: response has no 'elements' key")
        if not parsed["elements"]:
            # All feature groups in both regions are known non-empty, so an
            # empty set means a crippled mirror or a truncated response.
            raise Retryable(f"{endpoint}: 0 elements returned")
        return resp.content

    # HTTP 400 -> malformed query; retrying will never help. Fail fast.
    if resp.status_code == 400:
        snippet = resp.text[:300].replace("\n", " ")
        raise RuntimeError(
            f"{endpoint}: HTTP 400 for {label}: {snippet}"
        )

    # Anything else (429, 406 blocks, 5xx, gateway errors) -> try next endpoint.
    raise Retryable(f"{endpoint}: HTTP {resp.status_code}")


def fetch_overpass(query: str, label: str) -> bytes:
    """Run one query with endpoint fallback + exponential backoff retries."""
    last_err = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        for endpoint in ENDPOINTS:
            try:
                body = _post_once(endpoint, query, label)
                n = len(json.loads(body).get("elements", []))
                print(f"    ok via {endpoint} (attempt {attempt}): {n} elements")
                return body
            except RuntimeError:
                raise  # non-retryable (bad query) -- fail fast
            except Exception as exc:  # noqa: BLE001 -- any retryable cause
                last_err = exc
                print(f"    attempt {attempt} {endpoint}: {exc}")
        if attempt < MAX_ATTEMPTS:
            wait = BACKOFF_BASE_S * (2 ** (attempt - 1))
            print(f"    all endpoints failed; backing off {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"{label}: failed after {MAX_ATTEMPTS} attempts: {last_err}")


def build_query(group: str, bbox: tuple) -> str:
    bbox_str = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}"
    return QUERY_TEMPLATES[group].format(bbox=bbox_str, timeout=SERVER_TIMEOUT)


# --- main ------------------------------------------------------------------


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Overpass endpoints: {ENDPOINTS}")
    print(f"Output dir: {OUT_DIR}\n")

    failures = []
    written = []
    for region, bbox in BBOXES.items():
        for group in QUERY_TEMPLATES:
            label = f"{region}_{group}"
            dest = OUT_DIR / f"{label}.json"
            query = build_query(group, bbox)
            print(f"[{label}] querying ...")
            try:
                body = fetch_overpass(query, label)
            except Exception as exc:  # noqa: BLE001
                print(f"    FAILED: {exc}")
                failures.append(label)
                continue
            dest.write_bytes(body)
            written.append(dest)
            print(f"    wrote {dest} ({len(body) / 1e6:.1f} MB)")
            time.sleep(SLEEP_BETWEEN_REQUESTS_S)

    print("\n=== summary ===")
    print(f"written: {len(written)} file(s)")
    for p in written:
        print(f"  {p}")
    if failures:
        print(f"FAILED queries: {failures}")
        return 1
    print("all 8 downloads succeeded")
    return 0


if __name__ == "__main__":
    sys.exit(main())
