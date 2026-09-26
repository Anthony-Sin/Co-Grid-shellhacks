# Data Schema Contracts — Gridlock Challenge

All agents/producers/consumers MUST follow these schemas exactly.
Coordinates in GeoJSON files: **WGS84 lon/lat (EPSG:4326)**.
Projected math (distance, buffers): **EPSG:32617 (UTM 17N)** — covers both Savannah & Augusta.
Scene-local rendering coords: produced by `src/processing/scene_export.py` only (see Scene JSON below).

## Region bounding boxes (WGS84)

```python
BBOXES = {
    # Savannah metro: downtown Savannah, Effingham Co. (Plant McIntosh),
    # Jasper / Okatie / Bluffton on the SC side of the Savannah River
    "savannah":  {"min_lon": -81.55, "min_lat": 31.95, "max_lon": -80.75, "max_lat": 32.45},
    # Augusta metro: Urquhart (Beech Island SC), Augusta GA, toward Thomson
    "augusta":   {"min_lon": -82.30, "min_lat": 33.25, "max_lon": -81.60, "max_lat": 33.65},
}
```

Scene centers (for local-meter projection in the UI):
- `savannah`: `[-81.10, 32.13]`
- `augusta`:   `[-81.97, 33.45]`

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
`existing_transmission_line | existing_substation | existing_power_plant`
and `properties.utility` may be the recorded owner or `"unknown"`.

## 3. `data/processed/city_<scene>.json` — OSM city geometry for the 3D scene

```json
{
  "scene": "savannah",
  "center": [-81.10, 32.13],
  "buildings":  [{"id":..., "footprint":[[x,y],...], "height":12.0, "kind":"residential|commercial|civic|industrial|church|default"}],
  "roads":      [{"kind":"motorway|primary|secondary|residential|rail", "line":[[x,y],...]}],
  "water":      [{"kind":"river|coast|canal|lake", "polygon":[[x,y],...]}],
  "parks":      [{"kind":"park|wood|grass|wetland", "polygon":[[x,y],...]}],
  "bounds_m":   {"min_x":..,"max_x":..,"min_y":..,"max_y":..}
}
```

`x,y` are **local meters**: `x=(lon-c0)*111320*cos(c1)`, `y=(lat-c1)*110540`,
`c0,c1 = center`. Heights in meters (OSM `height` tag, else `building:levels`*3.2, else random 8-14 seeded by id).

## 4. `data/processed/overlaps.json` — ranked coordination opportunities

```json
{
  "generated_at": "ISO-8601",
  "region": "savannah_river_corridor",
  "overlaps": [{
    "overlap_id": "OV-0001",
    "project_a": "GPC-...", "project_b": "DESC-...",
    "utilities": ["GPC","DESC"],
    "min_distance_km": 3.42,
    "tier": 3,
    "tier_label": "shared_logistics",
    "tier_threshold_km": 8,
    "timeline_overlap": true,
    "shared_window": {"start": 2027, "end": 2029},
    "closest_point_a": [lon,lat], "closest_point_b": [lon,lat],
    "midpoint": [lon,lat],
    "score": 87.5,
    "explanation": "...",
    "cost": {"shared_row_acres": 12.4, "est_savings_usd_low": 400000, "est_savings_usd_high": 1200000, "basis": "..."},
    "zone": "savannah"
  }]
}
```

## 5. Tier definitions (IMMUTABLE)

| Tier | Distance (closest points) | Label            | Meaning                        |
|------|---------------------------|------------------|--------------------------------|
| 1    | 0 (touching/crossing)     | `touching`       | must coordinate outages/crossing |
| 2    | < 1.6 km                  | `shared_row`     | can share land/right-of-way    |
| 3    | < 8 km                    | `shared_logistics` | laydown yards, deliveries    |
| 4    | < 40 km                   | `shared_crews`   | crews, cranes, contractors     |

Timeline overlap = mandatory secondary signal; overlaps list separates
`timeline_overlap: true` first, but false matches still reported (flagged).

## 6. API endpoints (FastAPI, port 8000)

- `GET /api/health` → `{"ok": true}`
- `GET /api/projects?utility=&zone=` → projects.geojson contents
- `GET /api/basemap?zone=` → basemap.geojson contents
- `GET /api/city/{scene}` → city_<scene>.json
- `GET /api/overlaps?tier=&timeline_only=` → overlaps.json
- `GET /api/stats` → counts per utility/tier for dashboard header
