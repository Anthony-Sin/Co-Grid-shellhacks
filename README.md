# CO-GRID — Savannah River Corridor + Statewide

**Gridlock Challenge (Sperry Tech × Shell Hacks 2026).** Finds where two
electric utilities' *planned* construction projects overlap geographically
(≤ 40 km, closest-points) and in time, then ranks coordination
opportunities into tiers and renders them on a stylized 3D map.

Utilities tracked: **Georgia Power (GPC)** and **Dominion Energy South
Carolina (DESC)** (+ Santee Cooper/SCPSA) — planned projects cluster in
the Savannah River corridor (Savannah metro + Augusta), while the
existing-grid basemap and a dedicated **GA+SC state scene** cover the
full two-state envelope: 15.7k real HIFLD features, state/county borders,
interstate corridors, named rivers, 508 real places.

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
./venv/bin/python -m src.ingestion.hifld_download   # HIFLD grid layers (statewide)
./venv/bin/python -m src.ingestion.osm_download     # OSM city geometry (corridors)
./venv/bin/python -m src.ingestion.osm_pois         # named places (label chips)
./venv/bin/python -m src.ingestion.osm_power        # named substations (gazetteer)
./venv/bin/python -m src.ingestion.osm_places       # statewide cities/towns
./venv/bin/python -m src.ingestion.osm_borders      # state + county boundaries
# state_roads_rivers.json: interstate/trunk corridors + named rivers —
# one-off Overpass query documented in src/processing/build_state.py

# --- run the processing pipeline ---
./scripts/pipeline.sh                 # raw -> processed -> overlaps.json

# --- serve the API (port 8000) ---
./venv/bin/uvicorn src.api.main:app --host 127.0.0.1 --port 8000 --reload

# --- frontend (Node 22+, port 3210) ---
cd src/ui && npm install && npm run dev
# open http://127.0.0.1:3210  (vite proxies /api -> 127.0.0.1:8000)
```

Tests: `./venv/bin/python -m pytest tests/ -x -q`

### Headless screenshots (visual regression / review)

```bash
./scripts/screenshot.sh                        # all presets -> shots/
./scripts/screenshot.sh --out=/tmp/shots       # custom dir
./scripts/screenshot.sh "name|scene=augusta&select=OV-0004&panel=0"
```

Requires the dev server + API running and a system `chromium` binary
(software WebGL via `--enable-unsafe-swiftshader`, works GPU-less).
Deep-link params (`src/ui/src/lib/urlParams.ts`):

`?scene=savannah|augusta` `?select=<overlap_id>` (flies the camera)
`?focus=<lon>,<lat>` `?panel=0|1` `?tiers=1,2,3,4` `?timeline=0|1`

### AI coordination analyst (optional, server-side key)

The backend exposes an agentic analyst that answers questions **by calling
tools over the real processed data** — it never invents projects.

```bash
# .env (gitignored) — OpenAI-compatible chat-completions endpoint
AGENT_API_KEY=<your key>
AGENT_BASE_URL=https://api.tensormux.com/v1
AGENT_MODEL=glm-4-7-flash
```

| Route | What |
|---|---|
| `GET /api/agent/health` | configured?, model, tool list, max rounds |
| `POST /api/agent/chat` | `{messages: [{role,content}], overlap_id?}` → `{reply, reasoning, tool_trace, usage}` |
| `GET /api/agent/brief/{overlap_id}` | one-shot coordination brief for a record |

Tool layer (`src/agent/tools.py`): `stats`, `list_projects`, `get_project`,
`top_overlaps`, `get_overlap`, `projects_near`, `timeline_summary`,
`impact_estimate`, `gazetteer` — all read `data/processed/` only, unknown
tools/bad args return `{error}` instead of crashing the loop. The engine
(`src/agent/engine.py`) runs a bounded tool-call loop (native OpenAI
`tools` + a JSON-fallback for models that can't emit `tool_calls`) and
passes through the model's `reasoning` field when present.

The UI mounts a minimal Drive-style `AgentBar` (bottom pill + quick chips)
that sends conversation history + the selected overlap id as context.

Deterministic analysis API (no model needed, `src/analysis/`):

| Route | What |
|---|---|
| `GET /api/analysis/timeline` | yearly+quarterly build bands per utility, overlap-window stats |
| `GET /api/analysis/impacts?top=N` | per-overlap cost/impact rows (shared-corridor km in UTM, ROW acres, savings range, crew-share days) |
| `GET /api/analysis/impact/{id}` | one record, 404 on unknown id |

Other additions: `GET /api/regions` (scene/tile index — the contract for
statewide coverage) and `GET /api/overlaps.csv` (ranked flat export).

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
  analysis/          # timeline bands + impact/cost estimates (pure fns)
  agent/             # tool-calling analyst (client/engine/routes/tools)
  ui/                # Vite+React+TS+react-three-fiber 3D map (port 3210)
tests/               # engine unit tests (synthetic fixtures, logic only)
docs/DATA_SCHEMA.md  # the contract every stage follows
scripts/pipeline.sh  # one-shot regen
scripts/screenshot.{sh,mjs}  # headless UI captures -> shots/
```

Overlap ranking (immutable rules, `src/spatial/tiers.py`):
T1 touching · T2 < 1.6 km shared ROW · T3 < 8 km logistics · T4 < 40 km
crews. Timeline overlap is the mandatory secondary signal — reported
honestly, never faked.

### Visual language (sketch-the-city)

The map is monochrome "pencil on paper" (ArcGIS sketch-style technique):
translucent white building faces (~0.2 alpha) with dark jittered/overshot
ink outlines drawn twice, ink roads, grayscale water/parks, a procedural
`feTurbulence` paper grain behind a transparent canvas. **Color is
reserved for the data layer**: planned project geometry uses utility
colors, coordination zones use tier colors with diagonal hatching.
Large zones get airier hatching + fainter fills so markup never floods;
the map renders the top ~40 scored zones (all 226 stay listed/selectable).

### Performance notes

- `frameloop="demand"` — the scene renders only on change (controls,
  selection, data landing). A 12 fps `FrameTicker` drives ambient
  animation; camera flights self-pump at full speed. Hidden tab ⇒ zero GPU.
- Shadow map baked once per scene (`autoUpdate=false`; layers poke
  `useShadowRefresh` when casters mount) instead of re-rendered per frame.
- `dpr` capped at 1.5, merged/instanced geometry everywhere, ≤~250 draw
  calls, per-frame `useFrame` work limited to ~40 cheap opacity lerps.
- API payloads gzip'd (`GZipMiddleware`): the ~27 MB city scene ships ~5 MB.

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
  any data source used here. `AGENT_API_KEY` is read **server-side only**
  (`src/agent/client.py`) — it never enters the frontend bundle.
- Raw filings/GIS downloads stay out of git via `.gitignore`.
- API reads from `data/processed/` + `data/seeds/`; `/api/raw/*` is
  path-confined to `data/raw/`. Agent tools can't mutate anything —
  each call is a pure function over cached artifacts.
