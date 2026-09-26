# Changelog — Co-Grid / Gridlock Challenge

Everything added across the build, organized by subsystem. All data
paths are real public sources — no fabricated projects, overlaps, or
scenarios. Current dataset: **334 filed projects · 1,957 ranked
cross-utility overlap records · 9 utilities · GA + SC statewide**.

## Data & ingestion

- Statewide project seed: **334 real filed projects** across DESC,
  GPC, Santee Cooper/SCPSA, GTC, MEAG, Duke Carolinas, Duke Progress,
  Dalton Utilities, and Gainesville RRC — sourced from SCRTP committed
  project tables, SERTP 2026 expansion plans, IRP filings, GA ITS TYP,
  and PSC docket attachments (`89ff98f`, `6b62642`, `4064983`)
- Statewide basemap: **15.7k real HIFLD/OSM features** (substations,
  transmission context, roads, rivers) in 8.9 MB (`2b9aabe`, `80385c1`)
- Gazetteer: 9,710 real named facilities with provenance per record
  and an ambiguity guard (`1b66546`)
- Per-record provenance: every project carries its filing `source`
  URL; volatile `HIFLD 'UNKNOWN<id>'` anchors replaced with real OSM
  names or pinned explicit points (`d20d114`)
- Public-data ingestion expanded to full GA+SC coverage (`1233715`);
  `data/raw/README.md` documents the gitignored fetch step (`278d206`)

## Spatial engine & ranking

- STRtree-indexed, closest-point distance engine with the four-tier
  ranking rule — touching / <1.6 km / <8 km / <40 km — custom LCC
  projection (`9c56064`, `src/spatial/`)
- Per-record `zone` labels (incl. `a / b` composites) + `?zone=`
  filtering (`82ee75d`)
- Deterministic `overlaps.json` — `generated_at` derived from input
  mtime so identical inputs produce byte-identical output (`848d8b0`)

## Analysis modules (`src/analysis/`)

All pure functions, shared between API routes and agent tools:

- `timeline.py` — yearly/quarterly build bands + window stats (`0ab0912`)
- `impact.py` — shared-corridor km, ROW acres, savings range, crew-share
  days (`0ab0912`)
- `clusters.py` — staging-yard clusters bounded by the 40 km crew rule
  (`76c101f`, `e415497`)
- `playbook.py` — minimal season-years per cluster + peak concurrent
  sites (`9c2bc77`)
- `conflicts.py` — mandatory joint-outage subset: tier-1 + shared
  window (`75c3b07`)
- `calendar.py` — overlaps grouped by shared-window start year
  (`daf38d6`, extracted `66ec91e`)
- `nearby.py` — a site's staging neighborhood (extracted `e09b4ab`)
- `handoffs.py` — directed crew-relay graph over end-to-start adjacent
  records (`09f0e60`)
- `summary.py` — deterministic exec-summary card (`69a2be5`, `8805917`)
- `filters.py` — record filtering shared by `find_overlaps` and
  `/api/overlaps.csv` so exports are faithful (`effcf93`)

## API surface (FastAPI, port 8000)

- `GET /api/projects` — utility/zone/q filters
- `GET /api/overlaps` — tier, timeline_only, q, zone,
  `sort=score|distance|year`, `limit`/`offset` paging, `geometry=false`,
  `fields=` allowlist (`bcb7321`, `1b66546`)
- `GET /api/overlaps.csv` — ranked flat export, same filter set as the
  agent's `find_overlaps`, plus a `map_link` deep-link column
  (`aace026`, `d45cd7d`, `effcf93`)
- `GET /api/regions` — scene index + per-zone overlap rollup (`3833bc4`)
- `GET /api/stats` — counts + staging + peak season + per-utility
  coverage (`f79a80a`, `1962546`)
- `GET /api/meta` — artifact freshness (`db7b6ce`)
- `GET /api/analysis/*` — timeline, impacts, impact/{id}, brief/{id},
  clusters, playbook, calendar, conflicts, nearby/{id}, matrix,
  summary (`0ab0912`, `82d370e`, `bf9e11a`, `daf38d6`, `69a2be5`,
  `8805917`)
- Agent: `POST /api/agent/chat`, `POST /api/agent/chat/stream` (SSE —
  live `tool` events), `GET /api/agent/health`; per-IP rate limit on
  paid endpoints (`7d84911`, `6b68a6d`, `328335e`)
- GZip middleware — the 21 MB overlap artifact compresses ~10×
  (`a4fd05a`)

## Agent — 30-tool analyst (`src/agent/`)

Tool-calling loop over real artifacts only; fenced ` ```tool ` fallback
for non-function-calling models; unknown-tool self-correction and
transient retry (`7d84911`, `2a6b09f`).

- **Lookup**: `stats`, `exec_summary`, `list_projects` (utility/zone/
  source-filing filters), `get_project`, `gazetteer`, `data_health`,
  `define` (domain glossary)
- **Records**: `top_overlaps`, `get_overlap` (batch `overlap_ids` ≤30
  + `members` block — name/utility/voltage/window/filing source in one
  call), `find_overlaps` (+`csv_export` link), `project_overlaps`,
  `compare_overlaps`, `no_overlap_reason` (honest zero-result
  diagnosis), `overlap_neighbors` (exact per-site reach)
- **Rollups**: `zone_report`, `utility_profile`, `savings_rollup`,
  `voltage_match` (839 same-kV vs 1,118 interface records),
  `season_calendar`, `handoff_chains` (directed crew-relay paths),
  `timeline_summary`, `utility_matrix`
- **Analysis**: `staging_clusters`, `playbook`, `outage_conflicts`,
  `impact_estimate`, `why_ranked` (score decomposition + true
  tuple-rank position)
- **Counterfactuals**: `what_if_shift` (schedule slip — kept/lost/
  gained relationships), `what_if_drop_utility` (partner exit)

## UI (React + TS + react-three-fiber, port 3210)

- "Sketch-the-city" monochrome 3D map: project lines, overlap zones,
  staging layers, demand-mode rendering (`40969c3`, `d64153a`)
- Three scenes: Savannah River corridor + statewide GA/SC (`2c13296`)
- Ranked opportunities panel with region picker (`af95792`)
- Overlap detail card: tier, distance, shared window, cost estimate
  derived when unpriced, staging neighborhood, **copy-link button**
  (`19896ab`, `d602a86`)
- Agent bar: SSE streaming with live tool-progress line, markdown-lite
  replies (bold/tables/bullets), graceful degradation to the
  deterministic brief when no LLM key (`7b6b49f`, `3ca566e`, `0397e6f`)
- **Agent→map loop**: OV-ids and `?scene=` links in replies render as
  clickable chips that drive `selectOverlap`/`setActiveScene`
  (`10b21ab`); every tool output carries `deep_link`
- Quick-action chips: exec summary, top opportunities, explain
  selected, staging plan, timeline, 2027 season, crew relays,
  what-if slip, data health (`e17718c`, `a17056f`)
- Scene-aware header subtitle; utility palette covering all 9
  co-planners (`1ae9296`, `0cf088d`)

## Testing & verification

- 82 tests: engine (tier boundaries, falsy-zero regressions, same-
  utility exclusion), API routes over real artifacts, all 30 tools,
  agent engine (round loop, SSE error paths, fallback catalog),
  route/tool parity (`4de8a4d`, `d331b1b`, and per-feature tests)
- `scripts/verify.sh` — full gate: pytest, tsc+vite build, ≤500-line
  rule, artifact presence, tracked-secrets/raw-data guard (`04f6913`)
- `scripts/screenshot.mjs` + `screenshot.sh` — headless capture of all
  three scenes (`7cf5e6b`)

## Correctness fixes worth noting

- Falsy-zero sort: `distance=0.0` touching records sorted last →
  explicit `None` checks (`b3a1cf6`)
- Cluster `best_overlap` same trap → 0.0 km records win (`b3a1cf6`)
- DESC SCRTP citation `+1` drift across all project-of-54 notes
  (`d4fb56b`)
- `why_ranked` reported the id string as `rank_position` → real
  tuple-order position (`722bfc5`)
- Mislocated seed records repointed via gazetteer anchors (`01347e7`)
- Guaranteed-404 fetches on null selection; stale-data/leak/race
  sweeps (`7fd5c3f`, `f72fe6f`)
