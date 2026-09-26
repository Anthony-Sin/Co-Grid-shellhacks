/**
 * Mini-map "area snapshot" — a small inline SVG built ONLY from our own
 * processed data (projects.geojson, overlaps.json, state_bounds.geojson).
 * No tile servers, no imagery, no external APIs — the caption on the image
 * says exactly that.
 *
 * ONE string builder feeds both the right-rail detail cards (injected via
 * dangerouslySetInnerHTML — generated markup, no user text) and the exported
 * HTML report, so what renders in the rail is byte-for-byte what lands in
 * the downloaded file.
 *
 * Geography: simple equirectangular fit-to-bbox (lon scaled by cos(mid-lat)),
 * the same projection family as lib/projection.ts — honest shapes at the
 * sub-40km scales these thumbnails cover. Geometry extraction and the
 * closest-point distance machinery live in ./geoPrims.
 */

import type {
  FeatureCollection,
  GeoFeature,
  OverlapRecord,
  ProjectProps,
  StateBoundsProps,
} from './api'
import { TIER_COLORS } from './palette'
import { SCENE_CENTERS } from './projection'
import { utilityColor } from '../ui/components/utilityColors'
import {
  eachCoord,
  firstCoord,
  geomPrims,
  mergePrims,
  siblingsWithinKm,
} from './geoPrims'
import type { GeomLike, XY } from './geoPrims'

/** Thumbnail viewport — the card CSS scales it to the rail width. */
export const MINIMAP_W = 320
export const MINIMAP_H = 180
const MARGIN = 12

const INK = '#2B2B2B'
const PAPER = '#F8F6F0'
const CAPTION = 'map data: CO-GRID processed filings'

/* ================= spec builders (card + report share these) =============== */

export interface MiniMapSpec {
  /** featured projects — drawn strongest, in their utility colors */
  focus: GeoFeature<ProjectProps>[]
  /** direct counterparties — utility colors, lighter than focus */
  partners?: GeoFeature<ProjectProps>[]
  /** nearby siblings — dimmed ink context */
  context?: GeoFeature<ProjectProps>[]
  /** overlap zone polygon (lon/lat rings) + tier color */
  zone?: GeomLike | null
  zoneColor?: string
  /** closest-point markers A/B + connector */
  closestA?: { at: XY; color: string } | null
  closestB?: { at: XY; color: string } | null
  /** GA/SC borders — light hairline context */
  states?: FeatureCollection<StateBoundsProps> | null
  /** fallback fit anchor when nothing else has geometry */
  center?: XY | null
}

export function overlapContext(
  o: OverlapRecord,
  a: GeoFeature<ProjectProps> | undefined,
  b: GeoFeature<ProjectProps> | undefined,
  all: GeoFeature<ProjectProps>[],
  radiusKm = 30,
  cap = 14,
): GeoFeature<ProjectProps>[] {
  const anchor = mergePrims(
    a ? geomPrims(a.geometry) : undefined,
    b ? geomPrims(b.geometry) : undefined,
  )
  const latRef = o.midpoint?.[1] ?? firstCoord(anchor)?.[1] ?? SCENE_CENTERS.state[1]
  return siblingsWithinKm(
    all,
    anchor,
    latRef,
    radiusKm,
    new Set([o.project_a, o.project_b]),
    cap,
  )
}

export function overlapMapSpec(
  o: OverlapRecord,
  a: GeoFeature<ProjectProps> | undefined,
  b: GeoFeature<ProjectProps> | undefined,
  context: GeoFeature<ProjectProps>[],
  states: FeatureCollection<StateBoundsProps> | null,
): MiniMapSpec {
  return {
    focus: [a, b].filter((f): f is GeoFeature<ProjectProps> => Boolean(f)),
    context,
    zone: (o.zone_geometry as GeomLike | null | undefined) ?? null,
    zoneColor: TIER_COLORS[o.tier] ?? INK,
    closestA: o.closest_point_a
      ? { at: o.closest_point_a, color: utilityColor(a?.properties.utility) }
      : null,
    closestB: o.closest_point_b
      ? { at: o.closest_point_b, color: utilityColor(b?.properties.utility) }
      : null,
    states,
    center: o.midpoint ?? null,
  }
}

/** Other ends of this project's coordination records — the map's partners. */
export function projectPartnerIds(
  records: OverlapRecord[],
  projectId: string,
): Set<string> {
  const ids = new Set<string>()
  for (const o of records) {
    ids.add(o.project_a === projectId ? o.project_b : o.project_a)
  }
  return ids
}

export function projectContext(
  feature: GeoFeature<ProjectProps>,
  partnerIds: ReadonlySet<string>,
  all: GeoFeature<ProjectProps>[],
  radiusKm = 30,
  cap = 14,
): GeoFeature<ProjectProps>[] {
  const anchor = geomPrims(feature.geometry)
  const latRef = firstCoord(anchor)?.[1] ?? SCENE_CENTERS.state[1]
  const exclude = new Set(partnerIds)
  exclude.add(feature.properties.project_id)
  return siblingsWithinKm(all, anchor, latRef, radiusKm, exclude, cap)
}

export function projectMapSpec(
  feature: GeoFeature<ProjectProps>,
  partners: GeoFeature<ProjectProps>[],
  context: GeoFeature<ProjectProps>[],
  states: FeatureCollection<StateBoundsProps> | null,
): MiniMapSpec {
  return {
    focus: [feature],
    partners,
    context,
    states,
    center: firstCoord(geomPrims(feature.geometry)),
  }
}

/* ================= the SVG builder ========================================== */

/** Round the scale bar to a "nice" length ≤ ~78 px. */
function niceScaleKm(kmPerPx: number): number {
  const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200]
  let km = nice[0]
  for (const n of nice) if (n / kmPerPx <= 78) km = n
  return km
}

/**
 * Build the thumbnail SVG markup. Pure: same spec in -> same string out.
 * Returns a complete <svg> element (viewBox 320×180).
 */
export function miniMapSvg(spec: MiniMapSpec): string {
  const focus = spec.focus ?? []
  const partners = spec.partners ?? []
  const context = spec.context ?? []
  const zonePrims = spec.zone ? geomPrims(spec.zone) : null

  // ---- fit bbox over the FOCUS data only (context/states are background and
  // may legitimately run off-frame — SVG clipping handles them honestly)
  const fitPts: XY[] = []
  const collect = (f: GeoFeature<ProjectProps>) =>
    eachCoord(geomPrims(f.geometry), (p) => fitPts.push(p))
  focus.forEach(collect)
  partners.forEach(collect)
  if (zonePrims) eachCoord(zonePrims, (p) => fitPts.push(p))
  if (spec.closestA) fitPts.push(spec.closestA.at)
  if (spec.closestB) fitPts.push(spec.closestB.at)
  if (!fitPts.length && spec.center) fitPts.push(spec.center)
  if (!fitPts.length) fitPts.push(SCENE_CENTERS.state)

  const midLat = fitPts.reduce((s, p) => s + p[1], 0) / fitPts.length
  const cosLat = Math.cos((midLat * Math.PI) / 180) || 1e-6
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of fitPts) {
    const x = p[0] * cosLat
    const y = p[1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  // pad + minimum span (~4.4 km) so a single point still lands in context
  const pad = Math.max(Math.max(maxX - minX, maxY - minY) * 0.15, 0.02)
  minX -= pad
  maxX += pad
  minY -= pad
  maxY += pad
  const MIN_SPAN = 0.04
  if (maxX - minX < MIN_SPAN) {
    const c = (minX + maxX) / 2
    minX = c - MIN_SPAN / 2
    maxX = c + MIN_SPAN / 2
  }
  if (maxY - minY < MIN_SPAN) {
    const c = (minY + maxY) / 2
    minY = c - MIN_SPAN / 2
    maxY = c + MIN_SPAN / 2
  }
  const cw = MINIMAP_W - MARGIN * 2
  const ch = MINIMAP_H - MARGIN * 2
  const s = Math.min(cw / (maxX - minX), ch / (maxY - minY))
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const toPx = (p: XY): XY => [
    MINIMAP_W / 2 + (p[0] * cosLat - cx) * s,
    MINIMAP_H / 2 - (p[1] - cy) * s,
  ]
  // draw frame: the viewBox padded 40% each side — off-frame runs are
  // pen-lifted out so dense state-border rings don't balloon the markup
  const FX0 = -MINIMAP_W * 0.4
  const FX1 = MINIMAP_W * 1.4
  const FY0 = -MINIMAP_H * 0.4
  const FY1 = MINIMAP_H * 1.4
  const dPath = (pts: XY[], close = false): string => {
    let d = ''
    let pen = false
    let lx = 0
    let ly = 0
    for (const q of pts) {
      const [x, y] = toPx(q)
      if (x < FX0 || x > FX1 || y < FY0 || y > FY1) {
        pen = false
        continue
      }
      // drop sub-pixel wiggle — dense rings collapse hard at thumb scale
      if (pen && Math.abs(x - lx) < 0.6 && Math.abs(y - ly) < 0.6) continue
      d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
      pen = true
      lx = x
      ly = y
    }
    return d + (close && d ? 'Z' : '')
  }
  const dot = (p: XY, r: number, fill: string, op = 1): string => {
    const [x, y] = toPx(p)
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" fill-opacity="${op}" stroke="${INK}" stroke-width="1"/>`
  }

  const parts: string[] = [
    `<rect width="${MINIMAP_W}" height="${MINIMAP_H}" fill="${PAPER}"/>`,
  ]

  // state bounds — a light hairline border polyline only (per the brief);
  // rings are clipped to the padded frame and drawn as open strokes, so a
  // border far off-view simply doesn't render — honest absence, no fake fill
  for (const f of spec.states?.features ?? []) {
    const pr = geomPrims(f.geometry)
    for (const r of pr.rings) {
      const d = dPath(r)
      if (d)
        parts.push(
          `<path d="${d}" fill="none" stroke="${INK}" stroke-opacity="0.4" stroke-width="0.9" stroke-linejoin="round"/>`,
        )
    }
  }

  const drawFeature = (f: GeoFeature<ProjectProps>, color: string, w: number, op: number) => {
    const pr = geomPrims(f.geometry)
    const rd = pr.rings.map((r) => dPath(r, true)).join('')
    if (rd)
      parts.push(
        `<path d="${rd}" fill="${color}" fill-opacity="${(op * 0.25).toFixed(2)}" fill-rule="evenodd" stroke="${color}" stroke-opacity="${op}" stroke-width="${(w * 0.7).toFixed(1)}"/>`,
      )
    for (const l of pr.lines)
      parts.push(
        `<path d="${dPath(l)}" fill="none" stroke="${color}" stroke-opacity="${op}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
    for (const p of pr.pts) parts.push(dot(p, w + 0.9, color, op))
  }

  for (const f of context) drawFeature(f, INK, 1, 0.34)

  if (zonePrims && spec.zoneColor) {
    const d = zonePrims.rings.map((r) => dPath(r, true)).join('')
    if (d)
      parts.push(
        `<path d="${d}" fill="${spec.zoneColor}" fill-opacity="0.16" fill-rule="evenodd" stroke="${spec.zoneColor}" stroke-opacity="0.9" stroke-width="1.3" stroke-linejoin="round"/>`,
      )
  }

  for (const f of partners) drawFeature(f, utilityColor(f.properties.utility), 1.7, 0.7)
  for (const f of focus) drawFeature(f, utilityColor(f.properties.utility), 2.4, 0.95)

  // closest-point markers A/B + connector (concentric when touching)
  const A = spec.closestA
  const B = spec.closestB
  if (A && B) {
    const [ax, ay] = toPx(A.at)
    const [bx, by] = toPx(B.at)
    if (Math.hypot(ax - bx, ay - by) > 4) {
      parts.push(
        `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${INK}" stroke-opacity="0.55" stroke-width="1" stroke-dasharray="3 2.5"/>`,
        `<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="2.8" fill="${A.color}" stroke="${INK}" stroke-width="1"/>`,
        `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="2.8" fill="${B.color}" stroke="${INK}" stroke-width="1"/>`,
        `<text x="${(ax + 4.5).toFixed(1)}" y="${(ay - 3.5).toFixed(1)}" font-size="6.5" font-weight="800" fill="${INK}">A</text>`,
        `<text x="${(bx + 4.5).toFixed(1)}" y="${(by + 7).toFixed(1)}" font-size="6.5" font-weight="800" fill="${INK}">B</text>`,
      )
    } else {
      parts.push(
        `<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="4" fill="${A.color}" stroke="${INK}" stroke-width="1"/>`,
        `<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="2" fill="${B.color}" stroke="${INK}" stroke-width="0.8"/>`,
      )
    }
  } else {
    for (const m of [A, B]) {
      if (!m) continue
      const [x, y] = toPx(m.at)
      parts.push(
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.8" fill="${m.color}" stroke="${INK}" stroke-width="1"/>`,
      )
    }
  }

  // ---- furniture: scale bar, north arrow, honest-data caption
  const kmPerPx = 111.32 / s
  const km = niceScaleKm(kmPerPx)
  const barPx = km / kmPerPx
  const bx = MARGIN + 2
  const by = MINIMAP_H - 15
  const label = km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`
  parts.push(
    `<g stroke="${INK}" stroke-width="1">` +
      `<line x1="${bx}" y1="${by}" x2="${(bx + barPx).toFixed(1)}" y2="${by}"/>` +
      `<line x1="${bx}" y1="${by - 2.5}" x2="${bx}" y2="${by}"/>` +
      `<line x1="${(bx + barPx).toFixed(1)}" y1="${by - 2.5}" x2="${(bx + barPx).toFixed(1)}" y2="${by}"/>` +
      `</g>`,
    `<text x="${(bx + barPx + 4).toFixed(1)}" y="${(by + 2.5).toFixed(1)}" font-size="7.5" font-weight="700" fill="${INK}">${label}</text>`,
    `<g transform="translate(${MINIMAP_W - 16},14)">` +
      `<text x="0" y="-3" text-anchor="middle" font-size="8" font-weight="800" fill="${INK}">N</text>` +
      `<path d="M0 0 L3.6 11 L0 8.6 L-3.6 11 Z" fill="${INK}"/>` +
      `</g>`,
    `<text x="${MINIMAP_W - 6}" y="${MINIMAP_H - 5}" text-anchor="end" font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="7" fill="${INK}" fill-opacity="0.55">${CAPTION}</text>`,
  )

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MINIMAP_W} ${MINIMAP_H}" ` +
    `width="${MINIMAP_W}" height="${MINIMAP_H}" role="img" ` +
    `aria-label="Area snapshot drawn from CO-GRID processed filings">` +
    `<title>area snapshot — ${CAPTION}</title>` +
    parts.join('') +
    `</svg>`
  )
}
