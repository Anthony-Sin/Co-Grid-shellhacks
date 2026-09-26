# CO-GRID — Savannah River Corridor

**Gridlock Challenge (Sperry Tech × Shell Hacks 2026).** Finds where two
electric utilities' *planned* construction projects overlap geographically
(≤ 40 km, closest-points) and in time, then ranks coordination
opportunities into tiers and renders them on a stylized 3D city map.

Utilities tracked: **Georgia Power (GPC)** and **Dominion Energy South
Carolina (DESC)** across the Savannah River corridor — Savannah metro +
Augusta.

> Working with a coding agent? Hand it this file + `AGENTS.md` +
> `docs/DATA_SCHEMA.md` and it can rebuild everything from scratch.

---

## 1. Quick start

```bash
# --- backend (Python 3.14+, uv or pip) ---
uv venv venv --python 3.14            # or: python -m venv venv
uv pip install --python venv/bin/python -r requirements.txt
#   ^ or: ./venv/bin/pip install -r requirements.txt

# --- download real public data (no API keys needed) ---
./venv/bin/python -m src.ingestion.hifld_download   # HIFLD grid layers
./venv/bin/python -m src.ingestion.osm_download     # OSM city geometry

# --- run the processing pipeline ---
./scripts/pipeline.sh                 # raw -> processed -> overlaps.json

# --- serve the API (port 8000) ---
./venv/bin/uvicorn src.api.main:app --host 127.0.0.1 --port 8000 --reload

# --- frontend (Node 22+, port 3210) ---
cd src/ui && npm install && npm run dev
# open http://127.0.0.1:3210  (vite proxies /api -> 127.0.0.1:8000)
```

Tests: `./venv/bin/python -m pytest tests/ -x -q`

## 2. Data sources (all public, zero API keys)

| What | Where | Used for |
|---|---|---|
| HIFLD transmission lines / substations / power plants / retail territories | ArcGIS FeatureServer org `HDRa0B57OVrv2E1q` — `https://services5.arcgis.com/HDRa0B57OVrv2E1q/arcgis/rest/services/<Layer>/FeatureServer/0/query?...&f=geojson` (exact layer names + query template in `src/ingestion/hifld_download.py`, mirrored at `hifld-geoplatform.hub.arcgis.com`) | existing-grid basemap + named-facility anchors for project geometry |
| OpenStreetMap | `https://overpass-api.de/api/interpreter` (fallback `https://overpass.kumi.systems/api/interpreter`), queries in `src/ingestion/osm_download.py` | buildings, roads, water, parks for the 3D city |
| DESC planned projects | SCRTP/SERTP transmission plans + DESC IRP (SC PSC) — see `data/raw/filings/` + `data/raw/SOURCES.md` | `data/seeds/projects_seed.json` |
| GPC planned projects | Georgia Power IRP / 10-yr transmission plan (GA PSC dockets) — same as above | `data/seeds/projects_seed.json` |

`data/raw/` is read-only and gitignored; `data/processed/` is generated.
The ONLY hand-authored data is `data/seeds/projects_seed.json` — every
row cites a public filing URL. No mock data anywhere (AGENTS.md §7).

## 3. Architecture

```
data/raw/            # read-only downloads (gitignored)
data/seeds/          # curated, sourced project seeds (committed, small)
data/processed/      # generated artifacts the API serves (gitignored)
src/
  ingestion/         # hifld_download.py, osm_download.py  (network)
  processing/        # build_basemap / build_city / build_projects
  spatial/           # engine.py (STRtree + closest-point), tiers.py,
                     # timeline.py, ranker.py, schema.py
  api/               # FastAPI app (port 8000)
  ui/                # Vite+React+TS+react-three-fiber 3D map (port 3210)
tests/               # engine unit tests (synthetic fixtures, logic only)
docs/DATA_SCHEMA.md  # the contract every stage follows
scripts/pipeline.sh  # one-shot regen
```

Overlap ranking (immutable rules, `src/spatial/tiers.py`):
T1 touching · T2 < 1.6 km shared ROW · T3 < 8 km logistics · T4 < 40 km
crews. Timeline overlap is the mandatory secondary signal — reported
honestly, never faked.

## 4. Extending it (what a coding agent should do)

- **Add a project:** append a record to `data/seeds/projects_seed.json`
  (schema documented in `src/processing/build_projects.py` docstring),
  then `./scripts/pipeline.sh`. Give it a real `source` URL + either
  `point`/`line` coords or `facility`/`endpoints` names found in
  `data/raw/hifld/power_plants.geojson` or `substations.geojson`.
- **Add a region:** extend `SCENES`/`BBOXES` in
  `src/processing/projection.py` + `src/ingestion/osm_download.py`,
  re-run downloads + pipeline.
- **New overlap rules:** `src/spatial/tiers.py` is the only place
  distance thresholds live.

## 5. Security notes

- `.env` is gitignored (see `.env.example`); no keys are required for
  any data source used here.
- Raw filings/GIS downloads stay out of git via `.gitignore`.
- API is read-only GET; `/api/raw/*` is path-confined to `data/raw/`.
