/**
 * GeoJSON -> drawable primitives + honest closest-point distances.
 * Shared by the mini-map snapshot builder (miniMap.ts) and any other
 * thumbnail/export code that needs "which filed geometry is how close".
 */

import type { GeoFeature, ProjectProps } from './api'

export type XY = [number, number]

/* ================= geometry -> drawable primitives ========================= */

export interface Prims {
  /** open polylines (LineString / MultiLineString parts) */
  lines: XY[][]
  /** closed rings (Polygon / MultiPolygon parts, incl. holes) */
  rings: XY[][]
  /** standalone points (Point / MultiPoint) */
  pts: XY[]
}

const EMPTY_PRIMS: Prims = { lines: [], rings: [], pts: [] }

export type GeomLike = {
  type: string
  coordinates?: unknown
  geometries?: unknown
}

function asXY(v: unknown): XY | null {
  return Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number'
    ? [v[0], v[1]]
    : null
}

function asXYList(v: unknown): XY[] {
  if (!Array.isArray(v)) return []
  const out: XY[] = []
  for (const p of v) {
    const xy = asXY(p)
    if (xy) out.push(xy)
  }
  return out
}

function asXYListList(v: unknown): XY[][] {
  if (!Array.isArray(v)) return []
  const out: XY[][] = []
  for (const l of v) {
    const pts = asXYList(l)
    if (pts.length) out.push(pts)
  }
  return out
}

function fillPrims(g: GeomLike, out: Prims): void {
  switch (g.type) {
    case 'Point': {
      const p = asXY(g.coordinates)
      if (p) out.pts.push(p)
      break
    }
    case 'MultiPoint':
      out.pts.push(...asXYList(g.coordinates))
      break
    case 'LineString':
      out.lines.push(...asXYListList([g.coordinates]))
      break
    case 'MultiLineString':
      out.lines.push(...asXYListList(g.coordinates))
      break
    case 'Polygon':
      out.rings.push(...asXYListList(g.coordinates))
      break
    case 'MultiPolygon':
      for (const poly of Array.isArray(g.coordinates) ? g.coordinates : []) {
        out.rings.push(...asXYListList(poly))
      }
      break
    case 'GeometryCollection':
      for (const sub of Array.isArray(g.geometries) ? g.geometries : []) {
        fillPrims(sub as GeomLike, out)
      }
      break
  }
}

const primCache = new WeakMap<object, Prims>()

/** Geometry -> drawable primitives. Memoized per geometry object: the shared
 * API cache hands back stable feature objects, so repeat renders are free. */
export function geomPrims(geom: GeomLike | null | undefined): Prims {
  if (!geom || typeof geom !== 'object') return EMPTY_PRIMS
  const hit = primCache.get(geom)
  if (hit) return hit
  const out: Prims = { lines: [], rings: [], pts: [] }
  fillPrims(geom, out)
  primCache.set(geom, out)
  return out
}

export function mergePrims(...parts: (Prims | undefined)[]): Prims {
  const out: Prims = { lines: [], rings: [], pts: [] }
  for (const p of parts) {
    if (!p) continue
    out.lines.push(...p.lines)
    out.rings.push(...p.rings)
    out.pts.push(...p.pts)
  }
  return out
}

export function firstCoord(p: Prims): XY | null {
  return p.pts[0] ?? p.lines[0]?.[0] ?? p.rings[0]?.[0] ?? null
}

export function eachCoord(p: Prims, cb: (xy: XY) => void): void {
  for (const pt of p.pts) cb(pt)
  for (const l of p.lines) for (const pt of l) cb(pt)
  for (const r of p.rings) for (const pt of r) cb(pt)
}

/* ================= honest closest-point distances (km) =====================
 * Equirectangular km around a reference latitude (111.32 km/deg·cos(lat),
 * 110.54 km/deg — same constants as projection.ts). Segments compare with
 * true point-segment / segment-segment distance, intersection -> 0 — matching
 * the "closest points, not centroids" rule of the 40km spec. */

interface Ent {
  ax: number
  ay: number
  bx: number
  by: number
  seg: boolean
}

function entsOf(p: Prims, latRef: number): Ent[] {
  const kx = 111.32 * Math.cos((latRef * Math.PI) / 180)
  const ky = 110.54
  const ents: Ent[] = []
  const seg = (a: XY, b: XY) =>
    ents.push({ ax: a[0] * kx, ay: a[1] * ky, bx: b[0] * kx, by: b[1] * ky, seg: true })
  for (const l of p.lines) for (let i = 1; i < l.length; i++) seg(l[i - 1], l[i])
  for (const r of p.rings) for (let i = 1; i < r.length; i++) seg(r[i - 1], r[i])
  for (const pt of p.pts)
    ents.push({ ax: pt[0] * kx, ay: pt[1] * ky, bx: 0, by: 0, seg: false })
  return ents
}

function ptSegD2(px: number, py: number, e: Ent): number {
  const dx = e.bx - e.ax
  const dy = e.by - e.ay
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((px - e.ax) * dx + (py - e.ay) * dy) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const qx = e.ax + t * dx - px
  const qy = e.ay + t * dy - py
  return qx * qx + qy * qy
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

function segsCross(a: Ent, b: Ent): boolean {
  const d1 = orient(b.ax, b.ay, b.bx, b.by, a.ax, a.ay)
  const d2 = orient(b.ax, b.ay, b.bx, b.by, a.bx, a.by)
  const d3 = orient(a.ax, a.ay, a.bx, a.by, b.ax, b.ay)
  const d4 = orient(a.ax, a.ay, a.bx, a.by, b.bx, b.by)
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0
}

function entDist2(a: Ent, b: Ent): number {
  if (!a.seg && !b.seg) {
    const dx = a.ax - b.ax
    const dy = a.ay - b.ay
    return dx * dx + dy * dy
  }
  const pt = a.seg ? b : a
  const sg = a.seg ? a : b
  if (!a.seg || !b.seg) return ptSegD2(pt.ax, pt.ay, sg)
  if (segsCross(a, b)) return 0
  return Math.min(
    ptSegD2(a.ax, a.ay, b),
    ptSegD2(a.bx, a.by, b),
    ptSegD2(b.ax, b.ay, a),
    ptSegD2(b.bx, b.by, a),
  )
}

function entsDistKm(ea: Ent[], eb: Ent[]): number {
  let best = Infinity
  for (const x of ea) {
    for (const y of eb) {
      const d2 = entDist2(x, y)
      if (d2 < best) best = d2
      if (best === 0) return 0
    }
  }
  return Math.sqrt(best)
}

export function primsDistKm(a: Prims, b: Prims, latRef: number): number {
  return entsDistKm(entsOf(a, latRef), entsOf(b, latRef))
}

/**
 * Sibling features whose geometry comes within `radiusKm` of the anchor,
 * nearest first. Vertex-sparse filed lines compare segment-to-segment, so a
 * line crossing near the anchor counts even when its endpoints sit far away.
 */
export function siblingsWithinKm(
  all: GeoFeature<ProjectProps>[],
  anchor: Prims,
  latRef: number,
  radiusKm: number,
  exclude?: ReadonlySet<string>,
  cap = 14,
): GeoFeature<ProjectProps>[] {
  const ea = entsOf(anchor, latRef)
  if (!ea.length) return []
  const scored: { f: GeoFeature<ProjectProps>; d: number }[] = []
  for (const f of all) {
    if (exclude?.has(f.properties.project_id)) continue
    const eb = entsOf(geomPrims(f.geometry), latRef)
    if (!eb.length) continue
    const d = entsDistKm(ea, eb)
    if (d <= radiusKm) scored.push({ f, d })
  }
  scored.sort((x, y) => x.d - y.d)
  return scored.slice(0, cap).map((x) => x.f)
}
