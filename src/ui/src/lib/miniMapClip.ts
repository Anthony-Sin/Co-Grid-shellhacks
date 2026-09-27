/**
 * miniMapClip.ts — pixel-space clipping + path emitters for the area
 * snapshot renderer (miniMapSvg.ts). Real clipping, not vertex dropping:
 * Cohen–Sutherland for segments, Sutherland–Hodgman for rings, plus a
 * sub-pixel dedupe that keeps dense rings small at thumbnail scale.
 *
 * Everything runs in SVG pixel space AFTER the lonLatToLocal -> px
 * transform, against a clip rect inflated past the viewBox so cut strokes
 * read as "continuing off-map".
 */

import { eachCoord, geomPrims } from './geoPrims'
import type { GeomLike, XY } from './geoPrims'

export type Rect = readonly [number, number, number, number]
/** minX, minY, maxX, maxY — lon/lat or px depending on caller. */
export type BBox = [number, number, number, number]

export const f1 = (n: number) => n.toFixed(1)

/* ------------------------- px-space clipping ------------------------------ */

function outcode(x: number, y: number, r: Rect): number {
  let c = 0
  if (x < r[0]) c |= 1
  else if (x > r[2]) c |= 2
  if (y < r[1]) c |= 4
  else if (y > r[3]) c |= 8
  return c
}

/** Cohen–Sutherland — clipped segment endpoints, or null if fully outside. */
function clipSeg(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: Rect,
): [number, number, number, number] | null {
  let ca = outcode(ax, ay, r)
  let cb = outcode(bx, by, r)
  let x0 = ax, y0 = ay, x1 = bx, y1 = by
  for (;;) {
    if (!(ca | cb)) return [x0, y0, x1, y1]
    if (ca & cb) return null
    const c = ca || cb
    let x = 0
    let y = 0
    if (c & 8) { x = x0 + ((x1 - x0) * (r[3] - y0)) / (y1 - y0); y = r[3] }
    else if (c & 4) { x = x0 + ((x1 - x0) * (r[1] - y0)) / (y1 - y0); y = r[1] }
    else if (c & 2) { y = y0 + ((y1 - y0) * (r[2] - x0)) / (x1 - x0); x = r[2] }
    else { y = y0 + ((y1 - y0) * (r[0] - x0)) / (x1 - x0); x = r[0] }
    if (c === ca) { x0 = x; y0 = y; ca = outcode(x0, y0, r) }
    else { x1 = x; y1 = y; cb = outcode(x1, y1, r) }
  }
}

/** Sutherland–Hodgman — clip a closed ring to the rect, new vertex list. */
export function clipRing(ring: XY[], r: Rect): XY[] {
  let poly = ring
  const edge = (inside: (p: XY) => boolean, ix: (a: XY, b: XY) => XY) => {
    const res: XY[] = []
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i]
      const prev = poly[(i + poly.length - 1) % poly.length]
      const curIn = inside(cur)
      if (curIn) {
        if (!inside(prev)) res.push(ix(prev, cur))
        res.push(cur)
      } else if (inside(prev)) res.push(ix(prev, cur))
    }
    poly = res
  }
  const lx = (a: XY, b: XY, x: number): XY => {
    const t = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0])
    return [x, a[1] + (b[1] - a[1]) * t]
  }
  const ly = (a: XY, b: XY, y: number): XY => {
    const t = b[1] === a[1] ? 0 : (y - a[1]) / (b[1] - a[1])
    return [a[0] + (b[0] - a[0]) * t, y]
  }
  edge((p) => p[0] >= r[0], (a, b) => lx(a, b, r[0]))
  edge((p) => p[0] <= r[2], (a, b) => lx(a, b, r[2]))
  edge((p) => p[1] >= r[1], (a, b) => ly(a, b, r[1]))
  edge((p) => p[1] <= r[3], (a, b) => ly(a, b, r[3]))
  return poly
}

/* ------------------------------ path emitters ----------------------------- */

/** Drop consecutive vertices that collapse at thumbnail scale. */
export function dedupe(pts: XY[], tol = 0.55): XY[] {
  const out: XY[] = []
  for (const p of pts) {
    const q = out[out.length - 1]
    if (!q || Math.abs(p[0] - q[0]) >= tol || Math.abs(p[1] - q[1]) >= tol) out.push(p)
  }
  return out
}

/** Clipped polyline -> path data (pen lifts only where the clip cuts). */
export function linePath(pts: XY[], r: Rect): string {
  let d = ''
  let pen = false
  let lx = 0
  let ly = 0
  for (let i = 1; i < pts.length; i++) {
    const c = clipSeg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], r)
    if (!c) {
      pen = false
      continue
    }
    const [x0, y0, x1, y1] = c
    d += pen && x0 === lx && y0 === ly
      ? `L${f1(x1)} ${f1(y1)}`
      : `M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}`
    lx = x1
    ly = y1
    pen = true
  }
  return d
}

/** Clipped ring -> closed path data ('' when the ring misses the crop). */
export function ringPath(ring: XY[], r: Rect): string {
  const pts = dedupe(clipRing(ring, r))
  if (pts.length < 3) return ''
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`
  for (let i = 1; i < pts.length; i++) d += `L${f1(pts[i][0])} ${f1(pts[i][1])}`
  return d + 'Z'
}

/* ------------------------- coarse lon/lat bboxes -------------------------- */

const bbCache = new WeakMap<GeomLike, BBox | null>()

/** Geometry bbox in lon/lat — WeakMap-cached (the deduped API cache hands
 *  back stable geometry objects, so repeat snapshots reuse it). */
export function geomBBox(g: GeomLike): BBox | null {
  if (bbCache.has(g)) return bbCache.get(g) ?? null
  let b: BBox | null = null
  eachCoord(geomPrims(g), (p) => {
    if (!b) b = [p[0], p[1], p[0], p[1]]
    else {
      if (p[0] < b[0]) b[0] = p[0]
      if (p[1] < b[1]) b[1] = p[1]
      if (p[0] > b[2]) b[2] = p[0]
      if (p[1] > b[3]) b[3] = p[1]
    }
  })
  bbCache.set(g, b)
  return b
}

/** Round the scale bar to a "nice" length ≤ ~78 px. */
export function niceScaleKm(kmPerPx: number): number {
  const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200]
  let km = nice[0]
  for (const n of nice) if (n / kmPerPx <= 78) km = n
  return km
}
