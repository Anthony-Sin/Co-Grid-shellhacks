/**
 * WGS84 lon/lat <-> scene-local meter projection.
 * Matches docs/DATA_SCHEMA.md §3 exactly:
 *   x = (lon - c0) * 111320 * cos(c1)
 *   y = (lat - c1) * 110540
 * (+y is north; rendered as -z in the three.js scene so north is "up".)
 */

/** Local 2D point in meters [x, y] */
export type Vec2 = [number, number]

export type SceneId = 'savannah' | 'augusta'

/** Scene centers [lon, lat] from docs/DATA_SCHEMA.md */
export const SCENE_CENTERS: Record<SceneId, Vec2> = {
  savannah: [-81.1, 32.13],
  augusta: [-81.97, 33.45],
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

/** Inverse of {@link lonLatToLocal}: local meters -> [lon, lat] */
export function localToLonLat(x: number, y: number, center: Vec2): Vec2 {
  const [c0, c1] = center
  const lon = c0 + x / (METERS_PER_DEG_LON_EQUATOR * Math.cos((c1 * Math.PI) / 180))
  const lat = c1 + y / METERS_PER_DEG_LAT
  return [lon, lat]
}
