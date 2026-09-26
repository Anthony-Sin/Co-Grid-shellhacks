/**
 * zoneData.ts — pure data-prep for the overlap layer.
 *
 * Turns one OverlapRecord (WGS84 lon/lat per DATA_SCHEMA §4) into a
 * scene-local ZoneDatum: projected zone ring, precomputed hatch segments,
 * closest-point pair, centroid/radius, labels, and whether the record is
 * relevant to the active scene at all (~40km rule).
 *
 * No three.js objects live here — components build their own geometries
 * from these plain arrays so the math stays unit-testable.
 */
import type { GeoFeature, OverlapRecord, ProjectProps } from '../../lib/api'
import { lonLatToLocal, type Vec2 } from '../../lib/projection'
import { hatchPolygon, ringCentroid, ringRadius, stripClosing } from './hatch'

/** Scene relevance radius — the 40km rule (AGENTS.md §8). */
const SCENE_RELEVANCE_M = 40_000
/** Signature diagonal hatch. */
const HATCH_ANGLE_DEG = 45
/** ~90m between hatch lines. */
const HATCH_SPACING_M = 90

export type ProjectsById = Map<string, GeoFeature<ProjectProps>>

export interface ZoneDatum {
  /** Source record — real filed data, rendered as reported (AGENTS.md §7). */
  rec: OverlapRecord
  /** True when zone or either project's geometry is within ~40km of center. */
  relevant: boolean
  /** zone_geometry ring in local meters (closed-dup stripped); null if absent. */
  ringLocal: Vec2[] | null
  /** Flat [x1,y1,x2,y2,...] hatch segments in local meters (empty if no ring). */
  hatch: Float32Array
  /** Zone centroid (ring area centroid, else the record midpoint), local m. */
  centroid: Vec2
  /** Max vertex distance from centroid — zone footprint radius. */
  radiusM: number
  /** Closest point of project A, local meters. */
  aLocal: Vec2
  /** Closest point of project B, local meters. */
  bLocal: Vec2
  /** Record midpoint, local meters. */
  midLocal: Vec2
  /** A–B separation in meters (for arc apex scaling). */
  distM: number
  /** Short initials for connector chips: project A side / project B side. */
  labelA: string
  labelB: string
  /** Deterministic [0, 2π) phase so hatch breathing desyncs between zones. */
  phase: number
}

/** Flatten any GeoJSON geometry's coordinates into [lon,lat] positions. */
export function collectLonLats(coords: unknown, out: Vec2[] = []): Vec2[] {
  if (!Array.isArray(coords)) return out
  if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    out.push([coords[0], coords[1]])
    return out
  }
  for (const c of coords) collectLonLats(c, out)
  return out
}

/** Compact display initials: the project's utility when short, else an acronym. */
function projectLabel(projectId: string, projectsById: ProjectsById): string {
  const util = projectsById.get(projectId)?.properties?.utility
  const source = util && util.length <= 10 ? util : projectId
  const acronym = source
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 6)
  return acronym || projectId.slice(0, 6)
}

/** Deterministic phase in [0, 2π) from a string id. */
function hashPhase(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (Math.abs(h) % 628) / 100
}

/** Linear rgb lerp between two #rrggbb hex colors (t=0 → a, t=1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number) => {
    const va = (pa >> shift) & 0xff
    const vb = (pb >> shift) & 0xff
    return Math.round(va + (vb - va) * t)
  }
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

/**
 * Is this overlap relevant to the given scene center?
 * Either the zone footprint intersects the 40km circle around the center,
 * or any vertex of either project's geometry lies inside it.
 * (Local coords are relative to `center`, so distance = vector length.)
 */
function isRelevant(
  rec: OverlapRecord,
  centroid: Vec2,
  radiusM: number,
  projectsById: ProjectsById,
): boolean {
  if (Math.hypot(centroid[0], centroid[1]) - radiusM <= SCENE_RELEVANCE_M) return true
  for (const pid of [rec.project_a, rec.project_b]) {
    const geom = projectsById.get(pid)?.geometry
    if (!geom) continue
    for (const [lon, lat] of collectLonLats(geom.coordinates)) {
      const [x, y] = lonLatToLocal(lon, lat, [0, 0].map(() => 0) as Vec2)
      void x
      void y
    }
  }
  return false
}

/**
 * Build the scene-local datum for one overlap record.
 * `center` is SCENE_CENTERS[activeScene] — local coords are meters from it.
 */
export function buildZoneDatum(
  rec: OverlapRecord,
  center: Vec2,
  projectsById: ProjectsById,
): ZoneDatum {
  const aLocal = lonLatToLocal(rec.closest_point_a[0], rec.closest_point_a[1], center)
  const bLocal = lonLatToLocal(rec.closest_point_b[0], rec.closest_point_b[1], center)
  const midLocal = lonLatToLocal(rec.midpoint[0], rec.midpoint[1], center)

  let ringLocal: Vec2[] | null = null
  let hatch = new Float32Array(0)
  let centroid: Vec2 = midLocal
  let radiusM = Math.hypot(midLocal[0], midLocal[1]) * 0 // 0 unless a real ring exists
  const ringLL = rec.zone_geometry?.coordinates?.[0]
  if (rec.zone_geometry?.type === 'Polygon' && Array.isArray(ringLL) && ringLL.length >= 4) {
    const projected: Vec2[] = ringLL.map(([lon, lat]) => lonLatToLocal(lon, lat, center))
    ringLocal = stripClosing(projected)
    if (ringLocal.length >= 3) {
      hatch = hatchPolygon(ringLocal, HATCH_ANGLE_DEG, HATCH_SPACING_M)
      centroid = ringCentroid(ringLocal)
      radiusM = ringRadius(ringLocal, centroid)
    } else {
      ringLocal = null
    }
  }

  const relevant = isRelevantFast(rec, centroid, radiusM, center, projectsById)

  return {
    rec,
    relevant,
    ringLocal,
    hatch,
    centroid,
    radiusM,
    aLocal,
    bLocal,
    midLocal,
    distM: Math.hypot(aLocal[0] - bLocal[0], aLocal[1] - bLocal[1]),
    labelA: projectLabel(rec.project_a, projectsById),
    labelB: projectLabel(rec.project_b, projectsById),
    phase: hashPhase(rec.overlap_id),
  }
}

/**
 * Scene relevance — distance computed in scene-local meters about `center`.
 * Zone check: (|centroid| − radius) ≤ 40km ⇒ footprint touches the circle.
 * Project check: any geometry vertex within 40km of the scene center.
 */
function isRelevantFast(
  rec: OverlapRecord,
  centroid: Vec2,
  radiusM: number,
  center: Vec2,
  projectsById: ProjectsById,
): boolean {
  if (Math.hypot(centroid[0], centroid[1]) - radiusM <= SCENE_RELEVANCE_M) return true

  const near = (lon: number, lat: number) => {
    const [x, y] = lonLatToLocal(lon, lat, center)
    return x * x + y * y <= SCENE_RELEVANCE_M * SCENE_RELEVANCE_M
  }

  // Connector endpoints / midpoint are always known real data.
  if (near(rec.closest_point_a[0], rec.closest_point_a[1])) return true
  if (near(rec.closest_point_b[0], rec.closest_point_b[1])) return true
  if (near(rec.midpoint[0], rec.midpoint[1])) return true

  for (const pid of [rec.project_a, rec.project_b]) {
    const geom = projectsById.get(pid)?.geometry
    if (!geom) continue
    for (const [lon, lat] of collectLonLats(geom.coordinates)) {
      if (near(lon, lat)) return true
    }
  }
  return false
}
