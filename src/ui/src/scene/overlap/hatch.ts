/**
 * hatch.ts — diagonal hatching + ring math for overlap zones.
 *
 * The hatching is the signature visual of the coordination layer (salmon /
 * amber / blue / purple translucent zones with crisp diagonal hatch lines,
 * like axonometric planning maps).
 *
 * Method: exact scanline clipping (no sampling noise).
 *   1. Rotate the ring by -angle so hatch lines become horizontal scanlines.
 *   2. For each scanline, intersect it with every polygon edge (half-open
 *      interval avoids double-counting at vertices), sort the hits, and
 *      pair them even-odd → exact in-polygon segments.
 *   3. Rotate the segment endpoints back into the original space.
 * Deterministic, cheap for a handful of ~100-vertex capsule zones.
 */
import type { Vec2 } from '../../lib/projection'

/** Drop the GeoJSON closing vertex (first == last) if present. */
export function stripClosing(ring: readonly Vec2[]): Vec2[] {
  const n = ring.length
  if (n > 1) {
    const [fx, fy] = ring[0]
    const [lx, ly] = ring[n - 1]
    if (Math.abs(fx - lx) < 1e-9 && Math.abs(fy - ly) < 1e-9) {
      return ring.slice(0, n - 1)
    }
  }
  return ring.slice()
}

/** Polygon centroid via the shoelace formula; falls back to vertex mean. */
export function ringCentroid(ring: readonly Vec2[]): Vec2 {
  const pts = stripClosing(ring)
  if (pts.length === 0) return [0, 0]

  let cx = 0
  let cy = 0
  let area2 = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    const cross = x1 * y2 - x2 * y1
    area2 += cross
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
  }
  if (Math.abs(area2) < 1e-6) {
    // Degenerate ring (line/point) — plain vertex average.
    let sx = 0
    let sy = 0
    for (const [x, y] of pts) {
      sx += x
      sy += y
    }
    return [sx / pts.length, sy / pts.length]
  }
  return [cx / (3 * area2), cy / (3 * area2)]
}

/** Max distance from `center` to any ring vertex — zone "radius" in meters. */
export function ringRadius(ring: readonly Vec2[], center: Vec2): number {
  let r = 0
  for (const [x, y] of ring) {
    const d = Math.hypot(x - center[0], y - center[1])
    if (d > r) r = d
  }
  return r
}

/**
 * Diagonal hatch segments clipped to a polygon ring.
 *
 * @param ring      closed ring in local meters (clockwise or ccw, either works)
 * @param angleDeg  hatch angle in degrees (45 = classic diagonal)
 * @param spacingM  perpendicular distance between hatch lines, in meters
 * @returns flat [x1,y1, x2,y2, ...] segment endpoints in ring space,
 *          ready to expand into an xyz position attribute for LineSegments
 */
export function hatchPolygon(
  ring: readonly Vec2[],
  angleDeg = 45,
  spacingM = 90,
): Float32Array {
  const pts = stripClosing(ring)
  if (pts.length < 3) return new Float32Array(0)

  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  // Rotate ring by -angle: hatch scanlines become horizontal in this frame.
  const rot: Vec2[] = pts.map(([x, y]) => [x * cos + y * sin, -x * sin + y * cos])

  let minY = Infinity
  let maxY = -Infinity
  for (const [, y] of rot) {
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const spanY = maxY - minY
  if (spanY <= 0 || !Number.isFinite(spanY)) return new Float32Array(0)

  // Guarantee a few hatch lines even on narrow sliver zones.
  const step = Math.min(spacingM, Math.max(25, spanY / 3))

  const segs: number[] = []
  const n = rot.length
  for (let sy = minY + step / 2; sy < maxY; sy += step) {
    // Exact scanline x polygon-edge intersections (half-open y interval).
    const xs: number[] = []
    for (let i = 0; i < n; i++) {
      const [x1, y1] = rot[i]
      const [x2, y2] = rot[(i + 1) % n]
      if (y1 === y2) continue // horizontal edge contributes no crossing
      if ((y1 <= sy && sy < y2) || (y2 <= sy && sy < y1)) {
        xs.push(x1 + ((sy - y1) / (y2 - y1)) * (x2 - x1))
      }
    }
    if (xs.length < 2) continue
    xs.sort((a, b) => a - b)

    // Even-odd pairing → segment endpoints, rotated back to ring space.
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const ax = xs[i]
      const bx = xs[i + 1]
      if (bx - ax < 1e-3) continue
      // unrotate: R(+angle) applied to (x, sy)
      segs.push(ax * cos - sy * sin, ax * sin + sy * cos)
      segs.push(bx * cos - sy * sin, bx * sin + sy * cos)
    }
  }
  return Float32Array.from(segs)
}
