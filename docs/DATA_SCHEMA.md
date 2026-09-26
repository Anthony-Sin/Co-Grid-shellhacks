# Data Schema Contracts — Gridlock Challenge

All agents/producers/consumers MUST follow these schemas exactly.
Coordinates in GeoJSON files: **WGS84 lon/lat (EPSG:4326)**.
Projected math (distance, buffers): a **region-fit Lambert Conformal
Conic** (`src/spatial/crs.py` — `+proj=lcc +lat_0=32.5 +lon_0=-82.0
+lat_1=31.0 +lat_2=34.5`), chosen over UTM 17N because western Georgia
sits ~4.5° off UTM 17N's central meridian (~0.2% scale error at 40 km).
Scene-local rendering coords: produced by `src/processing/build_city.py`
and `src/processing/build_state.py` via `src/processing/projection.py`
(see Scene JSON below).

## Region bounding boxes (WGS84)

Single source of truth: `src/processing/projection.py` `SCENES` —
`/api/regions` and every scene filter derive bounds/centers from it:

- `savannah` bbox `(-81.55, 31.95, -80.75, 32.45)`, center `[-81.10, 32.13]`
- `augusta` bbox `(-82.30, 33.25, -81.60, 33.65)`, center `[-81.97, 33.45]`
- `state` bbox `(-85.70, 30.30, -78.00, 35.25)`, center `[-81.85, 32.78]`

The state bbox slightly over-extends so bbox-intersect pulls border
counties in FL/AL/TN/NC — intentional, for edge rendering.

## 1. `data/processed/projects.geojson` — utility planned projects

FeatureCollection. Every Feature:

```json
{
  "type": "Feature",
  "properties": {
    "project_id": "GPC-MCINTOSH-CT",      // stable unique slug
    "utility": "GPC",                     // "GPC" | "DESC" | "SanteeCooper" | ...
    "name": "Plant McIntosh CT expansion",
    "kind": "transmission_line",          // transmission_line|substation|plant|upgrade|reconductor
    "voltage_kv": 500,                    // number or null
    "start_year": 2026,                   // number or null
    "end_year": 2029,                     // number or null
    "status": "planned",                  // planned|under_construction|proposed
    "location_confidence": "verified",    // verified|endpoint_only|approximate
    "source": "GPC 2023 IRP Update, GA PSC Docket 44160",
    "notes": "..."
  },
  "geometry": { "type": "LineString"|"Point"|"Polygon"|"MultiLineString", "coordinates": [...] }
}
```

Rules:
- ONLY real, publicly-filed projects. If a route isn't published, use
  `location_confidence: "endpoint_only"` and connect the two known endpoint
  substations with a straight LineString — note it in `notes`.
- If a project's service territory isn't published precisely, `approximate` +
  a Point on the named facility.

## 2. `data/processed/basemap.geojson` — existing grid (HIFLD)

Same feature shape, but `properties.layer` in
`existing_transmission_line | existing_substation | existing_power_plant | service_territory | existing_tie_documented`
and `properties.utility` may be the recorded owner or `"unknown"`.

`existing_tie_documented` = the REAL cross-river inter-utility ties from
`data/seeds/context_facilities.json` (SCRTP contingency-table citations) —
rendered emphasized, they're why the overlap zones cluster where they do.

## 3. `data/processed/city_<scene>.json` — OSM city geometry for the 3D scene

```json
{
  "scene": "savannah",
  "center": [-81.10, 32.13],
  "buildings":  [{"id":..., "footprint":[[x,y],...], "height":12.0, "kind":"residential|commercial|civic|industrial|church|default"}],
  "roads":      [{"kind":"motorway|primary|secondary|residential|rail", "line":[[x,y],...]}],
  "water":      [{"kind":"river|coast|canal|lake", "polygon":[[x,y],...]}],
  "parks":      [{"kind":"park|wood|grass|wetland", "polygon":[[x,y],...]}],
  "pois":       [{"name":"Forsyth Park", "kind":"place|natural|amenity|waterway", "x":12.0, "y":34.0}],
  "bounds_m":   {"min_x":..,"max_x":..,"min_y":..,"max_y":..}
}
```

`x,y` are **local meters**: `x=(lon-c0)*111320*cos(c1)`, `y=(lat-c1)*110540`,
`c0,c1 = center`. Heights in meters (OSM `height` tag, else `building:levels`*3.2, else random 8-14 seeded by id).

`water` entries may carry either `polygon` (closed ring — corridors) OR
`line` (open polyline — rivers in the state scene). `pois[].pop` holds the
real OSM `population` tag when present (used to rank city labels).

### `city_state.json` — the statewide scene

Produced by `src/processing/build_state.py` from
`data/raw/osm/state_borders.json` (admin relations), `state_roads_rivers.json`
(motorway/trunk + named rivers), `statewide_places.json`. At state scale
**no buildings/parks are emitted** (honestly empty arrays) — the scene
carries boundaries, corridors, rivers, and places only:

- `roads[]`: state boundary `kind:"trunk"` rank 0 (double-inked), county
  boundaries `kind:"boundary"` rank 7, interstates `kind:"motorway"` rank 0
  / `trunk` rank 2.
- `water[]`: named rivers as `{"kind":"river","name":..,"line":[..]}`.
- `pois[]`: `kind:"place_city|place_town|place_suburb"` + optional `pop`.

## 4. `data/processed/overlaps.json` — ranked coordination opportunities

```json
{
  "generated_at": "ISO-8601 (mtime of projects.geojson — deterministic)",
  "generated_at_note": "mtime of projects.geojson input — deterministic",
  "region": "georgia_south_carolina",
  "project_count": 334,
  "overlaps": [{
    "overlap_id": "OV-0001",
    "project_a": "GPC-...", "project_b": "DESC-...",
    "utilities": ["GPC","DESC"],
    "min_distance_km": 3.42,
    "tier": 3,
    "tier_label": "shared_logistics",
    "tier_threshold_km": 8,
    "timeline_overlap": true,
    "timeline_adjacent": false,
    "shared_window": {"start": 2027, "end": 2029},
    "adjacent_window": null,
    "max_voltage_kv": 230,
    "closest_point_a": [lon,lat], "closest_point_b": [lon,lat],
    "midpoint": [lon,lat],
    "score": 87.5,
    "explanation": "...",
    "cost": {"shared_row_km": 1.1, "shared_row_acres": 12.4, "est_savings_usd_low": 400000, "est_savings_usd_high": 1200000, "basis": "..."},
    "zone": "savannah",
    "zone_geometry": {"type": "Polygon", "coordinates": [[[lon,lat],...]]}
  }]
}
```

`overlap_id` (`OV-NNNN`) is the record's position in the canonical engine
ordering (tier asc → distance asc → timeline-first). It is **not** a stable
foreign key across regenerations — ids renumber whenever the ranked set
changes. `zone_geometry` is the coordination-zone polygon rendered as the
hatched map highlight (a capsule bridging the two closest points).

## 5. Tier definitions (IMMUTABLE)

| Tier | Distance (closest points) | Label            | Meaning                        |
|------|---------------------------|------------------|--------------------------------|
| 1    | 0 (touching/crossing)     | `touching`       | must coordinate outages/crossing |
| 2    | < 1.6 km                  | `shared_row`     | can share land/right-of-way    |
| 3    | < 8 km                    | `shared_logistics` | laydown yards, deliveries    |
| 4    | < 40 km                   | `shared_crews`   | crews, cranes, contractors     |

Timeline overlap = mandatory secondary signal; overlaps list separates
`timeline_overlap: true` first, but false matches still reported (flagged).

Timeline semantics are strict: `timeline_overlap: true` means the build
windows **intersect** and `shared_window` holds that intersection.
`timeline_adjacent: true` means windows roll end-to-start within the
adjacency slack (1 yr) — `adjacent_window` holds the between-years gap.
Adjacency is a crew roll-forward signal, never a concurrent shared window;
only intersections schedule seasons/joint outages. A record where windows
don't meet has both flags false and both windows null.

## 6. API endpoints (FastAPI, port 8000)

- `GET /api/health` → `{"ok": true, "processed": [...artifact files...]}`
- `GET /api/projects?utility=&zone=` → projects.geojson contents
- `GET /api/basemap?zone=` → basemap.geojson contents
- `GET /api/city/{scene}` → city_<scene>.json
- `GET /api/regions` → scene/tile index: id, label, lon/lat bounds, center,
  artifact name, `built` flag, size_mb (statewide entries may be `built: false`)
- `GET /api/overlaps?tier=&timeline_only=&q=&zone=&sort=&limit=&offset=&geometry=&fields=`
  → overlaps.json + `total` (post-filter count, for paging) + `offset`;
  `geometry=false` strips `zone_geometry`; `fields=a,b,c` keeps only those keys
- `GET /api/overlaps.csv?tier=&timeline_only=` → ranked flat CSV export
- `GET /api/stats` → counts per utility/tier + `staging_yards`,
  `staging_corridors`, `peak_season`, per-utility `coverage`
- `GET /api/raw/{path}` → raw filing (path-confined to `data/raw/`)

Analysis API (`src/analysis/`, deterministic — no model):
- `GET /api/analysis/timeline` → yearly + quarterly build bands per utility,
  per-overlap shared-window stats, longest window, bucket histogram
- `GET /api/analysis/impacts?top=N` → all impact rows or top-N by savings high
- `GET /api/analysis/impact/{overlap_id}` → shared_corridor_km, row_width_m,
  corridor/zone/shared-ROW acres, shared_window_months, crew_share_days,
  est_savings_usd_range {low, high, basis}, assumptions[], confidence
- `GET /api/analysis/clusters?radius_km=` → yard-servable staging clusters
  (greedy disk-cover on overlap midpoints — every member within
  radius_km of the cluster's `yard_site`): cluster_id, yard_site,
  max_site_distance_km, utilities, tiers, member overlap_ids,
  corridor_id; `cluster_count` = yards needed. `corridors` lists the
  wider connectivity chains (context, not single-yard groups)
- `GET /api/analysis/calendar` → overlaps grouped by shared-window start year
- `GET /api/analysis/playbook?radius_km=&top=` → minimal season-years per
  yard cluster, peak concurrent sites (one yard's crew-sizing signal)
- `GET /api/analysis/conflicts` → tier-1 + shared-window subset — the
  mandatory joint-outage scheduling list, bucketed by season year
- `GET /api/analysis/nearby/{id}?radius_km=` → a site's staging neighborhood
- `GET /api/analysis/matrix` → utility-pair × tier overlap matrix
- `GET /api/analysis/summary` → deterministic exec-summary card: counts,
  dominant pair, peak season, mandatory outage count, top opportunity
- `GET /api/analysis/brief/{id}` → model-free prose brief for one overlap
  (same facts as the LLM brief; works without AGENT_API_KEY)

Agent API (`src/agent/`, needs `AGENT_API_KEY` env — server-side only):
- `GET /api/agent/health` → `{configured, model, tools, max_rounds}`
- `POST /api/agent/chat` → `{messages, overlap_id?}` →
  `{reply, reasoning, tool_trace[{tool,args,preview}], rounds, usage, finish_reason}`
- `POST /api/agent/chat/stream` → SSE: `tool` events live, then `final`, `done`
- `GET /api/agent/brief/{overlap_id}` → `{overlap_id, brief, reasoning, usage}`

Agent tools (names exactly as emitted to the model): `stats`, `list_projects`,
`get_project`, `top_overlaps`, `get_overlap`, `find_overlaps`,
`project_overlaps`, `projects_near`, `compare_overlaps`, `why_ranked`,
`zone_report`, `overlap_neighbors`, `timeline_summary`, `impact_estimate`,
`savings_rollup`,
`what_if_shift`, `what_if_drop_utility`, `season_calendar`, `gazetteer`, `data_health`,
`staging_clusters`, `playbook`, `outage_conflicts`, `utility_matrix`,
`exec_summary`, `define`.
