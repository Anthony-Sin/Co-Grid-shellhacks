/**
 * zoneHighlight.ts — in-zone building picking + tint-shell geometry.
 *
 * Contextual color-coding (ref: ref_img/color_coded_3d_buildign.png):
 * while the city stays monochrome paper/ink, buildings whose footprint
 * falls inside the SELECTED overlap's filed coordination zone get
 * re-extruded into a single merged shell drawn in that record's tier
 * color (the hovered overlap earns a fainter second shell).
 *
 * Coordinate space: everything here is scene-local meters [x, y] with
 * +y = north — the same plane building footprints live in before their
 * -90° X rotation stands them upright, so the mask test needs no
 * transform at all.
 *
 * Honesty (AGENTS §7): a record WITHOUT a filed zone_geometry yields NO
 * highlight — we deliberately do not fabricate a midpoint-radius circle.
 * Every overlap currently shipped in data/processed/overlaps.json carries
 * a real zone polygon, so this is a guard, not a routine path.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CityBuilding, OverlapRecord } from '../../lib/api'
import { lonLatToLocal, type Vec2 } from '../../lib/projection'
import { mulberry32 } from '../../lib/prng'
import { polygonShape } from '../shapeUtils'
import { cleanRing, pointInRing } from './cityUtils'

/**
 * Vertical lift of the tint shell so its roof plane clears the base
 * mesh's (z-fighting). Side walls stay coplanar — the material's
 * polygonOffset bias resolves those.
 */
export const OVERLAY_LIFT_M = 0.4

/**
 * Perf guard (AGENTS §6): tier-4 zones are ~40 km envelopes that can
 * legitimately contain most of a city's ~65k buildings — re-extruding
 * them on a selection change would stall the frame for seconds AND a
 * wash covering the whole skyline carries no signal anyway. Real
 * coordination capsules (tier 1–3, ~2.4 km wide) top out in the low
 * hundreds here, so hits beyond this cap honestly skip the tint; the
 * zone's own polygon/hatch still shows the true footprint.
 */
export const MAX_OVERLAY_BUILDINGS = 1200

/**
 * Building render height — the SINGLE source of truth for both the base
 * mesh and the tint shell (they must agree or the shell floats/sinks).
 *
 * Filed vs assumed: build_city.py `_height` resolves the OSM `height`
 * tag, then `building:levels` × 3.2, then a deterministic fallback of
 * exactly `8 + (osm_id % 7)`. ~98% of footprints carry the fallback,
 * which lands on only 7 integer heights — the skyline looked terraced.
 * We detect the fallback signature precisely (`h === 8 + id % 7`) and
 * give ONLY assumed heights a seeded 0.7–1.3× reshaping for silhouette
 * variety; filed heights render exactly as reported. (A filed height
 * coincidentally equal to the fallback value — rare — is reshaped too;
 * that only alters the extrusion, never the underlying record.)
 */
export function renderHeightM(b: CityBuilding): number {
  const h = b.height
  const filed = typeof h === 'number' && h > 0 && h !== 8 + (b.id % 7)
  if (filed) return Math.max(1.5, h)
  const assumed = typeof h === 'number' && h > 0 ? h : 8
  const rng = mulberry32((b.id >>> 0) ^ 0x27d4eb2f)
  return Math.max(1.5, assumed * (0.7 + rng() * 0.6))
}

/** A filed zone polygon projected to scene-local meters, plus its bbox. */
export interface ZoneMask {
  ring: Vec2[]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Project a record's zone_geometry (WGS84 GeoJSON Polygon) into
 * scene-local meters. Returns null when the record has no usable filed
 * zone ring — honest absence, no invented radius (AGENTS §7).
 */
export function zoneMaskLocal(
  rec: OverlapRecord,
  center: Vec2,
): ZoneMask | null {
  const ringLL = rec.zone_geometry?.coordinates?.[0]
  if (rec.zone_geometry?.type !== 'Polygon' || !Array.isArray(ringLL)) {
    return null
  }
  let ring: Vec2[] = ringLL.map(([lon, lat]) => lonLatToLocal(lon, lat, center))
  // GeoJSON rings repeat their first vertex — strip the closing dup.
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (ring.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) {
    ring = ring.slice(0, -1)
  }
  if (ring.length < 3) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of ring) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { ring, minX, minY, maxX, maxY }
}

/**
 * Per-building footprint centroids — the only per-building data the mask
 * test needs. Computed ONCE per city payload (the building list never
 * changes); NaN marks unusable rings so they can never match.
 * Centroid = plain vertex mean — buildings are tiny next to zone scale.
 */
export interface BuildingIndex {
  cx: Float64Array
  cy: Float64Array
}

export function indexBuildings(buildings: CityBuilding[]): BuildingIndex {
  const n = buildings.length
  const cx = new Float64Array(n).fill(NaN)
  const cy = new Float64Array(n).fill(NaN)
  for (let i = 0; i < n; i++) {
    const fp = buildings[i].footprint
    if (!fp || fp.length < 3) continue
    let count = fp.length
    const f = fp[0]
    const l = fp[fp.length - 1]
    if (count > 1 && f[0] === l[0] && f[1] === l[1]) count-- // closing dup
    let sx = 0
    let sy = 0
    for (let k = 0; k < count; k++) {
      sx += fp[k][0]
      sy += fp[k][1]
    }
    cx[i] = sx / count
    cy[i] = sy / count
  }
  return { cx, cy }
}

/**
 * Indices of buildings whose centroid lies inside the mask.
 * Bbox reject first — typically ~1 zone is active, so most of the ~70k
 * buildings are dropped by four comparisons and only survivors pay the
 * O(ring) point-in-polygon cost. Total: O(n), a few ms worst case.
 */
export function buildingsInMask(index: BuildingIndex, mask: ZoneMask): number[] {
  const hits: number[] = []
  const { cx, cy } = index
  for (let i = 0; i < cx.length; i++) {
    const x = cx[i]
    const y = cy[i]
    if (x < mask.minX || x > mask.maxX || y < mask.minY || y > mask.maxY) continue
    if (pointInRing(x, y, mask.ring)) hits.push(i)
  }
  return hits
}

/**
 * Merged extrusion for the in-zone buildings — the "red rooftops" shell.
 * Same footprint + render height as the base pass so the shell wraps the
 * base building exactly; the caller lifts the mesh by OVERLAY_LIFT_M.
 * Returns null when nothing falls inside — an honest empty result (e.g.
 * a zone over marsh or outside this scene's building coverage) — and
 * also null past MAX_OVERLAY_BUILDINGS (city-blanket tier-4 envelopes:
 * too slow to rebuild, and a whole-city wash says nothing).
 */
export function buildOverlayGeometry(
  buildings: CityBuilding[],
  hits: number[],
): { geometry: THREE.BufferGeometry; count: number } | null {
  if (hits.length > MAX_OVERLAY_BUILDINGS) {
    console.debug(
      `[zoneHighlight] ${hits.length} buildings inside zone > cap ${MAX_OVERLAY_BUILDINGS} — skipping tint (city-wide envelope)`,
    )
    return null
  }
  const parts: THREE.BufferGeometry[] = []
  for (const i of hits) {
    const ring = cleanRing(buildings[i].footprint)
    if (!ring) continue
    const geo = new THREE.ExtrudeGeometry(polygonShape(ring), {
      depth: renderHeightM(buildings[i]),
      bevelEnabled: false,
    })
    geo.rotateX(-Math.PI / 2) // same up-stand as the base pass
    geo.deleteAttribute('uv')
    parts.push(geo)
  }
  if (!parts.length) return null
  const geometry = mergeGeometries(parts, false)
  return geometry ? { geometry, count: parts.length } : null
}
