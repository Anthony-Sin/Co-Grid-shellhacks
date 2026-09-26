/**
 * Shared plumbing for the grid overlay: utility brand colors (spec-fixed;
 * deliberately NOT part of PALETTE), WGS84 lon/lat -> scene-local meter
 * helpers, polyline resampling for pylon anchors + catenary-ish wire sag,
 * and the per-scene filter (a feature belongs to a scene when ANY of its
 * coords lands within ~35km of that scene's center).
 * Positions are meters; three.js placement is [x, h, -y] (north = -z).
 */
import type { BasemapProps, FeatureCollection, GeoFeature, ProjectProps } from '../../lib/api'
import { lonLatToLocal, SCENE_CENTERS, type SceneId, type Vec2 } from '../../lib/projection'

/* ------------------------------------------------------------------ */
/* utility colors                                                      */
/* ------------------------------------------------------------------ */

export const UTILITY_COLORS = {
  GPC: '#D97B29', // warm orange
  DESC: '#2E86AB', // steel blue
  SANTEE: '#7A9E43',
  GTC: '#8E44AD',
  MEAG: '#B03A2E',
  DUKEC: '#117A65',
  DUKEP: '#7D6608',
  DU: '#4A5A6A',
  GRID: '#0E7C86',
  OTHER: '#6B7280',
} as const

/** Map a utility code / owner name to its display color. */
export function utilityColor(utility: string | null | undefined): string {
  const u = (utility ?? '').toUpperCase()
  if (u === 'GPC' || u.includes('GEORGIA POWER')) return UTILITY_COLORS.GPC
  if (u === 'DESC' || u.includes('SCE&G') || u.includes('SOUTH CAROLINA ELECTRIC'))
    return UTILITY_COLORS.DESC
  if (u.includes('SANTEE') || u === 'SCPSA' || u.includes('PUBLIC SERVICE AUTHORITY'))
    return UTILITY_COLORS.SANTEE
  if (u === 'GTC' || u.includes('GEORGIA TRANSMISSION')) return UTILITY_COLORS.GTC
  if (u === 'MEAG') return UTILITY_COLORS.MEAG
  if (u === 'DUKECAROLINAS' || u === 'DUKE PROGRESS CAROLINAS') return UTILITY_COLORS.DUKEC
  if (u === 'DUKEPROGRESS') return UTILITY_COLORS.DUKEP
  if (u === 'DU' || u.includes('DALTON')) return UTILITY_COLORS.DU
  if (u === 'GRID') return UTILITY_COLORS.GRID
  return UTILITY_COLORS.OTHER
}

/* ------------------------------------------------------------------ */
/* GeoJSON geometry traversal (defensive — recurses Multi* / odd types) */
/* ------------------------------------------------------------------ */

export type LonLat = [number, number]
type AnyGeometry = GeoFeature<unknown>['geometry'] | null | undefined

function isLonLat(v: unknown): v is LonLat {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  )
}

/** Every [lon,lat] vertex in any GeoJSON geometry, order preserved. */
export function geomCoords(geom: AnyGeometry): LonLat[] {
  const out: LonLat[] = []
  const walk = (node: unknown): void => {
    if (isLonLat(node)) {
      out.push([node[0], node[1]])
    } else if (Array.isArray(node)) {
      for (const child of node) walk(child)
    }
  }
  walk(geom?.coordinates)
  return out
}

/** LineString / MultiLineString -> array of lon/lat polylines (>=2 pts each). */
export function geomLines(geom: AnyGeometry): LonLat[][] {
  if (!geom || !Array.isArray(geom.coordinates)) return []
  const c = geom.coordinates as unknown[]
  if (geom.type === 'LineString') {
    const line = c.filter(isLonLat)
    return line.length >= 2 ? [line] : []
  }
  if (geom.type === 'MultiLineString') {
    return c
      .map((part) => (Array.isArray(part) ? part.filter(isLonLat) : []))
      .filter((l) => l.length >= 2)
  }
  return []
}

/** Point / MultiPoint -> lon/lat list. */
export function geomPoints(geom: AnyGeometry): LonLat[] {
  if (!geom) return []
  if (geom.type === 'Point' && isLonLat(geom.coordinates)) return [geom.coordinates]
  if (geom.type === 'MultiPoint' && Array.isArray(geom.coordinates))
    return (geom.coordinates as unknown[]).filter(isLonLat)
  return []
}

/** Simple vertex-average centroid in lon/lat (null if geometry is empty). */
export function geomCentroid(geom: AnyGeometry): LonLat | null {
  const pts = geomCoords(geom)
  if (pts.length === 0) return null
  let x = 0
  let y = 0
  for (const [a, b] of pts) {
    x += a
    y += b
  }
  return [x / pts.length, y / pts.length]
}

/** True if ANY geometry vertex projects within `radiusM` of `center`. */
export function geomWithinRadius(geom: AnyGeometry, center: Vec2, radiusM: number): boolean {
  const r2 = radiusM * radiusM
  for (const [lon, lat] of geomCoords(geom)) {
    const [x, y] = lonLatToLocal(lon, lat, center)
    if (x * x + y * y <= r2) return true
  }
  return false
}

/** Project a lon/lat polyline to local meters. */
export function projectLine(line: readonly LonLat[], center: Vec2): Vec2[] {
  return line.map(([lon, lat]) => lonLatToLocal(lon, lat, center))
}

/* ------------------------------------------------------------------ */
/* polyline resampling: pylon anchors + sagging wire path              */
/* ------------------------------------------------------------------ */

export interface Anchor {
  x: number
  y: number
  /** heading of the line at this point (radians, local plane) */
  yaw: number
}

/**
 * Anchor points along a local-meter polyline: every original vertex plus
 * interpolated points at ~`spacing` so spans stay short for sag/pylons.
 */
export function resampleLine(line: readonly Vec2[], spacing: number): Anchor[] {
  // dedupe consecutive identical vertices
  const pts: Vec2[] = []
  for (const p of line) {
    const q = pts[pts.length - 1]
    if (!q || q[0] !== p[0] || q[1] !== p[1]) pts.push(p)
  }
  if (pts.length === 0) return []
  if (pts.length === 1) return [{ x: pts[0][0], y: pts[0][1], yaw: 0 }]

  const anchors: Anchor[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    const dx = x1 - x0
    const dy = y1 - y0
    const segLen = Math.hypot(dx, dy)
    if (segLen === 0) continue
    const yaw = Math.atan2(dx, dy)
    if (anchors.length === 0) anchors.push({ x: x0, y: y0, yaw })
    const n = Math.floor(segLen / spacing)
    for (let k = 1; k <= n; k++) {
      const t = (k * spacing) / segLen
      anchors.push({ x: x0 + dx * t, y: y0 + dy * t, yaw })
    }
    anchors.push({ x: x1, y: y1, yaw })
  }
  // drop duplicates <1m apart (can happen at shared vertices)
  return anchors.filter(
    (a, i) => i === 0 || Math.hypot(a.x - anchors[i - 1].x, a.y - anchors[i - 1].y) > 1,
  )
}

/**
 * Catenary-ish wire path through anchors at `height` m: each span sags
 * parabolically, bottoming out `height * sagFrac` (~8%) below the tops.
 * Returns three.js-ready [x, y(up), z] tuples (local y -> -z).
 */
export function sagWirePoints(
  anchors: readonly Anchor[],
  height: number,
  sagFrac = 0.08,
  stepsPerSpan = 6,
): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i]
    const b = anchors[i + 1]
    for (let s = 0; s < stepsPerSpan; s++) {
      const t = s / stepsPerSpan
      const sag = height * sagFrac * 4 * t * (1 - t)
      out.push([a.x + (b.x - a.x) * t, height - sag, -(a.y + (b.y - a.y) * t)])
    }
  }
  const last = anchors[anchors.length - 1]
  if (last) out.push([last.x, height, -last.y])
  return out
}

/* ------------------------------------------------------------------ */
/* per-scene filtering                                                 */
/* ------------------------------------------------------------------ */

/** Feature belongs to a scene if ANY coord lands within this of center.
 * Corridor scenes filter tightly (~35 km); the statewide scene covers the
 * whole GA+SC envelope (~460 km from the state center). */
const POINT_RADIUS_M = 36_000
const LINE_RADIUS_M = 42_000
export const PROJECT_RADIUS_M = 35_000
const STATE_RADIUS_M = 460_000

function radiiFor(scene: SceneId) {
  const big = scene === 'state'
  return {
    point: big ? STATE_RADIUS_M : POINT_RADIUS_M,
    line: big ? STATE_RADIUS_M : LINE_RADIUS_M,
    project: big ? STATE_RADIUS_M : PROJECT_RADIUS_M,
  }
}

export interface SceneLine {
  points: Vec2[]
  voltage: number
  name: string
}
export interface SceneSub {
  x: number
  y: number
  name: string
  voltage: number
}
export interface ScenePlant {
  x: number
  y: number
  name: string
  fuel: string | null
}

export interface SceneProject {
  id: string
  name: string
  kind: string
  utility: string
  confidence: string
  voltageKv: number
  /** filed construction window — null when the filing omits a year */
  startYear: number | null
  endYear: number | null
  /** free-text filing notes (used for honest fuel/shape hints) */
  notes: string
  /** local-meter polylines (empty for point-sited projects) */
  lines: Vec2[][]
  /** local-meter points (empty for pure line projects) */
  points: Vec2[]
  /** local-meter centroid for the floating label chip */
  centroid: Vec2
}

export interface SceneGrid {
  existingLines: SceneLine[]
  existingSubs: SceneSub[]
  existingPlants: ScenePlant[]
  lineProjects: SceneProject[]
  stationProjects: SceneProject[]
  plantProjects: SceneProject[]
  projects: SceneProject[]
}

const LINE_KINDS = new Set(['transmission_line', 'reconductor'])
const STATION_KINDS = new Set(['substation', 'upgrade'])

/** First Point/MultiPoint vertex within `radiusM`, projected to local. */
function firstPointWithin(geom: AnyGeometry, center: Vec2, radiusM: number): Vec2 | null {
  const r2 = radiusM * radiusM
  for (const [lon, lat] of geomPoints(geom)) {
    const [x, y] = lonLatToLocal(lon, lat, center)
    if (x * x + y * y <= r2) return [x, y]
  }
  return null
}

/**
 * Filter + project a region-wide dataset down to what this scene renders.
 * service_territory polygons are intentionally skipped: they are
 * state-scale footprints that would flood the whole viewport.
 */
export function filterToScene(
  basemap: FeatureCollection<BasemapProps>,
  projects: FeatureCollection<ProjectProps>,
  scene: SceneId,
): SceneGrid {
  const center = SCENE_CENTERS[scene]
  const r = radiiFor(scene)
  const grid: SceneGrid = {
    existingLines: [],
    existingSubs: [],
    existingPlants: [],
    lineProjects: [],
    stationProjects: [],
    plantProjects: [],
    projects: [],
  }

  for (const f of basemap.features) {
    const props = f.properties
    const layer = props?.layer
    if (layer === 'existing_transmission_line') {
      if (!geomWithinRadius(f.geometry, center, r.line)) continue
      for (const part of geomLines(f.geometry)) {
        grid.existingLines.push({
          points: projectLine(part, center),
          voltage: props.voltage_kv ?? 0,
          name: props.name ?? '',
        })
      }
    } else if (layer === 'existing_substation') {
      const pt = firstPointWithin(f.geometry, center, r.point)
      if (pt)
        grid.existingSubs.push({
          x: pt[0],
          y: pt[1],
          name: props.name ?? '',
          voltage: props.voltage_kv ?? 0,
        })
    } else if (layer === 'existing_power_plant') {
      const pt = firstPointWithin(f.geometry, center, r.point)
      if (pt)
        grid.existingPlants.push({
          x: pt[0],
          y: pt[1],
          name: props.name ?? '',
          fuel: props.fuel ?? null,
        })
    }
  }

  for (const f of projects.features) {
    const p = f.properties
    if (!p || !geomWithinRadius(f.geometry, center, r.project)) continue
    const centroidLl = geomCentroid(f.geometry)
    if (!centroidLl) continue
    const lines = geomLines(f.geometry).map((part) => projectLine(part, center))
    // a point-sited project filed with only a route still needs a site —
    // anchor it at the first vertex so it renders *something* honest
    const points = geomPoints(f.geometry).map(([lon, lat]) =>
      lonLatToLocal(lon, lat, center),
    )
    if (points.length === 0 && lines.length > 0) points.push(lines[0][0])
    const sp: SceneProject = {
      id: p.project_id ?? p.name ?? 'unknown',
      name: p.name ?? p.project_id ?? 'unnamed project',
      kind: p.kind ?? 'unknown',
      utility: p.utility ?? '',
      confidence: p.location_confidence ?? 'approximate',
      voltageKv: p.voltage_kv ?? 0,
      startYear: p.start_year ?? null,
      endYear: p.end_year ?? null,
      notes: p.notes ?? '',
      lines,
      points,
      centroid: lonLatToLocal(centroidLl[0], centroidLl[1], center),
    }
    grid.projects.push(sp)
    // corridor work is drawn as a line even when kind is 'upgrade' — the
    // geometry is the source of truth (real filings have upgrade LineStrings)
    if (LINE_KINDS.has(sp.kind) || (STATION_KINDS.has(sp.kind) && sp.lines.length > 0))
      grid.lineProjects.push(sp)
    else if (STATION_KINDS.has(sp.kind)) grid.stationProjects.push(sp)
    else if (sp.kind === 'plant') grid.plantProjects.push(sp)
    // unknown kinds still get their ProjectMarkers chip via grid.projects
  }

  return grid
}
