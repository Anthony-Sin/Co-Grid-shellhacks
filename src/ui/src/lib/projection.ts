/**
 * WGS84 lon/lat <-> scene-local meter projection.
 * Matches docs/DATA_SCHEMA.md §3 exactly:
 *   x = (lon - c0) * 111320 * cos(c1)
 *   y = (lat - c1) * 110540
 * (+y is north; rendered as -z in the three.js scene so north is "up".)
 */

/** Local 2D point in meters [x, y] */
export type Vec2 = [number, number]

export type SceneId =
  | 'savannah'
  | 'augusta'
  | 'state'
  | 'atlanta'
  | 'columbia'
  | 'charleston'
  | 'greenville_sc'
  | 'columbus_ga'
  | 'athens'
  | 'macon'

/** Scene centers [lon, lat] from docs/DATA_SCHEMA.md + projection.py SCENES */
export const SCENE_CENTERS: Record<SceneId, Vec2> = {
  savannah: [-81.1, 32.13],
  augusta: [-81.97, 33.45],
  state: [-81.85, 32.78],
  atlanta: [-84.39, 33.755],
  columbia: [-81.035, 34.0],
  charleston: [-79.94, 32.8],
  greenville_sc: [-82.395, 34.845],
  columbus_ga: [-84.99, 32.46],
  athens: [-83.38, 33.955],
  macon: [-83.635, 32.84],
}

const METERS_PER_DEG_LAT = 110540
const METERS_PER_DEG_LON_EQUATOR = 111320

/** lon/lat (EPSG:4326) -> local meters relative to `center` [lon, lat] */
export function lonLatToLocal(lon: number, lat: number, center: Vec2): Vec2 {
  const [c0, c1] = center
  const x = (lon - c0) * METERS_PER_DEG_LON_EQUATOR * Math.cos((c1 * Math.PI) / 180)
  const y = (lat - c1) * METERS_PER_DEG_LAT
  return [x, y]
}

/** Single-scene build: every zone renders in the statewide GA+SC view, so
 * zone→scene always resolves 'state'. Kept as a function (backend parity
 * with projection.scene_for_zone) so callers don't need to know. */
export function sceneForZone(_zone: string | null | undefined): SceneId {
  return 'state'
}
