/**
 * WGS84 lon/lat <-> scene-local meter projection.
 * Matches docs/DATA_SCHEMA.md §3 exactly:
 *   x = (lon - c0) * 111320 * cos(c1)
 *   y = (lat - c1) * 110540
 * (+y is north; rendered as -z in the three.js scene so north is "up".)
 */

/** Local 2D point in meters [x, y] */
export type Vec2 = [number, number]

export type SceneId = 'savannah' | 'augusta' | 'state'

/** Scene centers [lon, lat] from docs/DATA_SCHEMA.md + projection.py SCENES */
export const SCENE_CENTERS: Record<SceneId, Vec2> = {
  savannah: [-81.1, 32.13],
  augusta: [-81.97, 33.45],
  state: [-81.85, 32.78],
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

/** Mirror of src/processing/projection.py `scene_for_zone` — zone tag →
 * best-fit scene. Selecting an overlap outside the active scene must
 * switch scenes first or the camera flies to empty space. Keep in sync. */
export function sceneForZone(zone: string | null | undefined): SceneId {
  const z = (zone ?? '').toLowerCase()
  if (z.includes('savannah')) return 'savannah'
  if (z.includes('augusta')) return 'augusta'
  return 'state'
}
