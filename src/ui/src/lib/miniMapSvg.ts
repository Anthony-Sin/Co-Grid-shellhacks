/**
 * miniMapSvg.ts — the AREA SNAPSHOT renderer: a small inline SVG built
 * ONLY from our own processed data (projects.geojson, overlaps.json,
 * basemap.geojson, state_bounds.geojson). No tile servers, no imagery —
 * the caption on the image says exactly that.
 *
 * It reads like a real map, not a diagram: the crop is a tight box around
 * the zone + featured projects (~25% margin, expanded to the frame's
 * aspect), GA+SC land polygons are filled + stroked and clipped to it,
 * the existing HIFLD grid and every filed project line passing through
 * the crop are drawn as thin ink context, and the zone + focus geometries
 * sit on top in tier/utility colors. Scale bar, north arrow and the
 * honest-data caption carry over from the original abstract snapshot.
 *
 * Every lon/lat vertex runs through the shared
 * lonLatToLocal(SCENE_CENTERS.state) projection — the same affine frame
 * the map scene uses — so lines land exactly where the map puts them.
 * Clipping is real clipping (Cohen–Sutherland segments, Sutherland–Hodgman
 * rings) against a rect inflated ~10px past the viewBox, so borders/lines
 * leaving the frame read as "continuing off-map", never as artificial
 * edges; the SVG viewBox does the final cut.
 */

import type { GeoFeature, ProjectProps } from './api'
import { eachCoord, geomPrims } from './geoPrims'
import type { GeomLike, XY } from './geoPrims'
import { lonLatToLocal, SCENE_CENTERS } from './projection'
import type { Vec2 } from './projection'
import { utilityColor } from '../ui/components/utilityColors'
import type { MiniMapSpec, ZoneSpec } from './miniMapSpec'
import {
  clipRing,
  dedupe,
  f1,
  geomBBox,
  linePath,
  niceScaleKm,
  ringPath,
} from './miniMapClip'
import type { BBox } from './miniMapClip'

/** Thumbnail viewport — the card CSS scales it to the rail width. */
export const MINIMAP_W = 320
export const MINIMAP_H = 180

const INK = '#2B2B2B'
/** Beyond the state polygons — deeper paper so land reads as land. */
const OUTSIDE = '#E5E0CF'
/** State land sheet — same web-map convention as PALETTE.flat.land. */
const LAND = '#F6F2E5'
/** Paper-tone casing (border halo + focus underlay). */
const HALO = '#F8F5EC'
const GRID_INK = '#5C584D' // existing HIFLD grid
const CTX_INK = '#39362D' // other filed projects through the crop
const CAPTION = 'map data: CO-GRID processed filings'

/** Shared projection frame — identical to the statewide scene's. */
const C = SCENE_CENTERS.state
const DEG_LON_M = 111320 * Math.cos((C[1] * Math.PI) / 180)
const DEG_LAT_M = 110540

/** Geometry is clipped ~10px past the viewBox so strokes that leave the
 *  frame die off-screen (the viewBox itself is the honest crop edge). */
const BLEED = 10
const CLIP = [-BLEED, -BLEED, MINIMAP_W + BLEED, MINIMAP_H + BLEED] as const

const MIN_SPAN_M = 4200 // a lone point still lands in ~4km of context
const PAD_F = 0.25 // ~25% margin around the focus bbox
const MAX_CTX = 80 // markup guard on crop-filtered sibling projects

/* ------------------------------ the builder ------------------------------- */

/**
 * Build the thumbnail SVG markup. Pure: same spec in -> same string out.
 * Returns a complete <svg> element (viewBox 320×180).
 */
export function miniMapSvg(spec: MiniMapSpec): string {
  const focus = spec.focus ?? []
  const partners = spec.partners ?? []

  // ---- crop box: focus + zone + closest points, in scene-local meters.
  // Partners count only where they reach NEAR that core box — a 40km-tier
  // counterparty's far line tail mustn't stretch the crop off the detail.
  const fitM: Vec2[] = []
  const collectM = (g: GeomLike | null | undefined) =>
    eachCoord(geomPrims(g), (p) => fitM.push(lonLatToLocal(p[0], p[1], C)))
  for (const f of focus) collectM(f.geometry)
  collectM(spec.zone)
  if (spec.closestA) fitM.push(lonLatToLocal(spec.closestA.at[0], spec.closestA.at[1], C))
  if (spec.closestB) fitM.push(lonLatToLocal(spec.closestB.at[0], spec.closestB.at[1], C))
  if (!fitM.length && spec.center)
    fitM.push(lonLatToLocal(spec.center[0], spec.center[1], C))
  if (!fitM.length) fitM.push([0, 0])

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const m of fitM) {
    if (m[0] < x0) x0 = m[0]
    if (m[1] < y0) y0 = m[1]
    if (m[0] > x1) x1 = m[0]
    if (m[1] > y1) y1 = m[1]
  }
  const grow = (m: Vec2) => {
    if (m[0] < x0) x0 = m[0]
    if (m[0] > x1) x1 = m[0]
    if (m[1] < y0) y0 = m[1]
    if (m[1] > y1) y1 = m[1]
  }
  // partner reach box: the core box grown 40% (min 3km), FIXED — nearer
  // partner geometry joins the fit; a long line tail stretching away stays
  // context clipped to the frame rather than dragging the crop with it
  const rx = Math.max((x1 - x0) * 0.4, 3000)
  const ry = Math.max((y1 - y0) * 0.4, 3000)
  const reach: BBox = [x0 - rx, y0 - ry, x1 + rx, y1 + ry]
  for (const f of partners) {
    eachCoord(geomPrims(f.geometry), (p) => {
      const m = lonLatToLocal(p[0], p[1], C)
      if (m[0] >= reach[0] && m[0] <= reach[2] && m[1] >= reach[1] && m[1] <= reach[3])
        grow(m)
    })
  }
  // ~25% margin + minimum span, then expand the short axis to the frame
  // aspect so the crop fills the thumbnail edge-to-edge (no letterbox)
  const pdx = (x1 - x0) * PAD_F * 0.5 + 1
  const pdy = (y1 - y0) * PAD_F * 0.5 + 1
  x0 -= pdx; x1 += pdx; y0 -= pdy; y1 += pdy
  if (x1 - x0 < MIN_SPAN_M) { const c = (x0 + x1) / 2; x0 = c - MIN_SPAN_M / 2; x1 = c + MIN_SPAN_M / 2 }
  if (y1 - y0 < MIN_SPAN_M) { const c = (y0 + y1) / 2; y0 = c - MIN_SPAN_M / 2; y1 = c + MIN_SPAN_M / 2 }
  const aspect = MINIMAP_W / MINIMAP_H
  if ((x1 - x0) / (y1 - y0) < aspect) {
    const c = (x0 + x1) / 2
    const w = (y1 - y0) * aspect
    x0 = c - w / 2; x1 = c + w / 2
  } else {
    const c = (y0 + y1) / 2
    const h = (x1 - x0) / aspect
    y0 = c - h / 2; y1 = c + h / 2
  }
  const s = Math.min(MINIMAP_W / (x1 - x0), MINIMAP_H / (y1 - y0)) // px per meter
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const toPx = (m: Vec2): XY => [
    MINIMAP_W / 2 + (m[0] - cx) * s,
    MINIMAP_H / 2 - (m[1] - cy) * s,
  ]
  const toPxLL = (p: XY): XY => toPx(lonLatToLocal(p[0], p[1], C))

  // clip rect (incl. bleed) back-projected to lon/lat — coarse reject for
  // the 15k-feature basemap so off-crop layers cost one bbox compare each
  const lonAt = (px: number) => C[0] + ((px - MINIMAP_W / 2) / s + cx) / DEG_LON_M
  const latAt = (py: number) => C[1] + (cy - (py - MINIMAP_H / 2) / s) / DEG_LAT_M
  const llMin: XY = [lonAt(CLIP[0]), latAt(CLIP[3])]
  const llMax: XY = [lonAt(CLIP[2]), latAt(CLIP[1])]
  const inCrop = (g: GeomLike): boolean => {
    const b = geomBBox(g)
    return !!b && b[0] <= llMax[0] && b[2] >= llMin[0] && b[1] <= llMax[1] && b[3] >= llMin[1]
  }

  const parts: string[] = [`<rect width="${MINIMAP_W}" height="${MINIMAP_H}" fill="${OUTSIDE}"/>`]

  // ---------- land: filled GA/SC polygons clipped to the crop ----------
  // (Census 500k cartographic boundary — real coastline + the Savannah
  // River line between the states; islands are their own small polygons)
  {
    let fills = ''
    let edges = ''
    for (const f of spec.states?.features ?? []) {
      for (const r of geomPrims(f.geometry).rings) {
        const d = ringPath(r.map(toPxLL), CLIP)
        if (d) { fills += d; edges += d }
      }
    }
    if (fills) {
      parts.push(
        `<path d="${fills}" fill="${LAND}" fill-rule="evenodd"/>`,
        `<path d="${edges}" fill="none" stroke="${HALO}" stroke-width="3" stroke-opacity="0.85" stroke-linejoin="round"/>`,
        `<path d="${edges}" fill="none" stroke="${INK}" stroke-width="1.1" stroke-opacity="0.8" stroke-linejoin="round"/>`,
      )
    }
  }

  // ---------- existing grid (basemap): lines, substations, plants -------
  if (spec.basemap) {
    let lines = ''
    let subs = ''
    let plants = ''
    for (const f of spec.basemap.features) {
      const layer = f.properties?.layer
      if (layer === 'service_territory' || !inCrop(f.geometry)) continue
      const pr = geomPrims(f.geometry)
      if (layer === 'existing_substation' || layer === 'existing_power_plant') {
        for (const p of pr.pts) {
          const [x, y] = toPxLL(p)
          if (x < -2 || x > MINIMAP_W + 2 || y < -2 || y > MINIMAP_H + 2) continue
          const h = layer === 'existing_power_plant' ? 1.5 : 1.0
          const sq = `M${f1(x - h)} ${f1(y - h)}h${h * 2}v${h * 2}h${-h * 2}Z`
          if (layer === 'existing_power_plant') plants += sq
          else subs += sq
        }
      } else {
        for (const l of pr.lines) lines += linePath(dedupe(l.map(toPxLL)), CLIP)
        for (const r of pr.rings) lines += linePath(dedupe(r.map(toPxLL)), CLIP)
      }
    }
    if (lines)
      parts.push(
        `<path d="${lines}" fill="none" stroke="${GRID_INK}" stroke-opacity="0.42" stroke-width="0.55" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
    if (subs) parts.push(`<path d="${subs}" fill="${GRID_INK}" fill-opacity="0.45"/>`)
    if (plants) parts.push(`<path d="${plants}" fill="${GRID_INK}" fill-opacity="0.6"/>`)
  }

  // ---------- other filed projects passing through the crop -----------
  {
    const seen = new Set<string>()
    for (const f of [...focus, ...partners]) seen.add(f.properties.project_id)
    let d = ''
    let dots = ''
    const drawCtx = (f: GeoFeature<ProjectProps>) => {
      if (seen.has(f.properties.project_id) || !inCrop(f.geometry)) return
      seen.add(f.properties.project_id)
      const pr = geomPrims(f.geometry)
      for (const l of pr.lines) d += linePath(dedupe(l.map(toPxLL)), CLIP)
      for (const r of pr.rings) d += linePath(dedupe(r.map(toPxLL)), CLIP)
      for (const p of pr.pts) {
        const [x, y] = toPxLL(p)
        if (x >= -2 && x <= MINIMAP_W + 2 && y >= -2 && y <= MINIMAP_H + 2)
          dots += `M${f1(x - 1.1)} ${f1(y)}a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0`
      }
    }
    for (const f of spec.context ?? []) drawCtx(f)
    let n = 0
    for (const f of spec.allProjects ?? []) {
      if (n >= MAX_CTX) break
      const before = d.length + dots.length
      drawCtx(f)
      n += d.length + dots.length > before ? 1 : 0
    }
    if (d)
      parts.push(
        `<path d="${d}" fill="none" stroke="${CTX_INK}" stroke-opacity="0.5" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
    if (dots)
      parts.push(`<path d="${dots}" fill="${CTX_INK}" fill-opacity="0.55" stroke="none"/>`)
  }

  // ---------- coordination zone(s): translucent tier fill, light hatch,
  // thin border — the map treatment, scaled down (no giant hatch here) --
  const zones: (ZoneSpec & { primary?: boolean })[] = []
  if (spec.zone && spec.zoneColor)
    zones.push({ geom: spec.zone, color: spec.zoneColor, primary: true })
  zones.push(...(spec.zones ?? []))
  if (zones.length) {
    const defs: string[] = []
    const patId = new Map<string, string>()
    let zi = 0
    const frameArea = MINIMAP_W * MINIMAP_H
    let drawn = 0
    for (const z of zones.slice(0, 10)) {
      // clip first: a zone that swallows the whole frame (a ~40km tier-4
      // capsule at a 20km crop) communicates nothing — and stacked ones
      // would flood the land in a solid wash. Draw only zones that read
      // as AREAS inside the crop; the rest stay honest context off-frame.
      const clipped: XY[][] = []
      let area = 0
      for (const r of geomPrims(z.geom).rings) {
        const c = clipRing(dedupe(r.map(toPxLL)), CLIP)
        if (c.length < 3) continue
        let a2 = 0
        for (let i = 0; i < c.length; i++) {
          const p = c[i]
          const q = c[(i + 1) % c.length]
          a2 += p[0] * q[1] - q[0] * p[1]
        }
        area += Math.abs(a2) / 2
        clipped.push(c)
      }
      if (!clipped.length || area >= frameArea * 0.85 || drawn >= 8) continue
      drawn++
      let d = ''
      for (const c of clipped) {
        d += `M${f1(c[0][0])} ${f1(c[0][1])}`
        for (let i = 1; i < c.length; i++) d += `L${f1(c[i][0])} ${f1(c[i][1])}`
        d += 'Z'
      }
      let id = patId.get(z.color)
      if (!id) {
        id = `cgsnap-zh${zi++}`
        patId.set(z.color, id)
        defs.push(
          `<pattern id="${id}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
            `<line x1="0" y1="0" x2="0" y2="7" stroke="${z.color}" stroke-opacity="0.3" stroke-width="1"/>` +
            `</pattern>`,
        )
      }
      // the record's own zone gets the map treatment (fill + light hatch +
      // firm outline); sibling/context zones stay quiet — a whisper of
      // fill and a thin dashed outline so stacked capsules never flood
      parts.push(
        `<path d="${d}" fill="${z.color}" fill-opacity="${z.primary ? 0.14 : 0.05}" fill-rule="evenodd"/>`,
        ...(z.primary
          ? [`<path d="${d}" fill="url(#${id})" fill-rule="evenodd"/>`]
          : []),
        `<path d="${d}" fill="none" stroke="${z.color}" stroke-opacity="${z.primary ? 0.85 : 0.5}" stroke-width="${z.primary ? 1.3 : 1}"${z.primary ? '' : ' stroke-dasharray="4 3"'} stroke-linejoin="round"/>`,
      )
    }
    if (defs.length) parts.unshift(`<defs>${defs.join('')}</defs>`)
  }

  // ---------- projects: context < partners < focus ----------------------
  const drawFeature = (
    f: GeoFeature<ProjectProps>,
    color: string,
    w: number,
    op: number,
  ) => {
    const pr = geomPrims(f.geometry)
    let d = ''
    for (const l of pr.lines) d += linePath(dedupe(l.map(toPxLL)), CLIP)
    for (const r of pr.rings) d += linePath(dedupe(r.map(toPxLL)), CLIP)
    if (d)
      parts.push(
        `<path d="${d}" fill="none" stroke="${HALO}" stroke-opacity="0.9" stroke-width="${f1(w + 2.2)}" stroke-linecap="round" stroke-linejoin="round"/>`,
        `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="${op}" stroke-width="${f1(w)}" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
    for (const p of pr.pts) {
      const [x, y] = toPxLL(p)
      if (x < -3 || x > MINIMAP_W + 3 || y < -3 || y > MINIMAP_H + 3) continue
      parts.push(
        `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(w + 0.9)}" fill="${color}" fill-opacity="${op}" stroke="${INK}" stroke-width="1"/>`,
      )
    }
  }

  for (const f of partners) drawFeature(f, utilityColor(f.properties.utility), 1.7, 0.75)
  for (const f of focus) drawFeature(f, utilityColor(f.properties.utility), 2.4, 0.95)

  // ---------- closest-point markers A/B + connector (as before) --------
  const A = spec.closestA
  const B = spec.closestB
  if (A && B) {
    const [ax, ay] = toPxLL(A.at)
    const [bx, by] = toPxLL(B.at)
    if (Math.hypot(ax - bx, ay - by) > 4) {
      parts.push(
        `<line x1="${f1(ax)}" y1="${f1(ay)}" x2="${f1(bx)}" y2="${f1(by)}" stroke="${INK}" stroke-opacity="0.55" stroke-width="1" stroke-dasharray="3 2.5"/>`,
        `<circle cx="${f1(ax)}" cy="${f1(ay)}" r="2.8" fill="${A.color}" stroke="${INK}" stroke-width="1"/>`,
        `<circle cx="${f1(bx)}" cy="${f1(by)}" r="2.8" fill="${B.color}" stroke="${INK}" stroke-width="1"/>`,
        `<text x="${f1(ax + 4.5)}" y="${f1(ay - 3.5)}" font-size="6.5" font-weight="800" fill="${INK}">A</text>`,
        `<text x="${f1(bx + 4.5)}" y="${f1(by + 7)}" font-size="6.5" font-weight="800" fill="${INK}">B</text>`,
      )
    } else {
      parts.push(
        `<circle cx="${f1(ax)}" cy="${f1(ay)}" r="4" fill="${A.color}" stroke="${INK}" stroke-width="1"/>`,
        `<circle cx="${f1(ax)}" cy="${f1(ay)}" r="2" fill="${B.color}" stroke="${INK}" stroke-width="0.8"/>`,
      )
    }
  } else {
    for (const m of [A, B]) {
      if (!m) continue
      const [x, y] = toPxLL(m.at)
      parts.push(
        `<circle cx="${f1(x)}" cy="${f1(y)}" r="2.8" fill="${m.color}" stroke="${INK}" stroke-width="1"/>`,
      )
    }
  }

  // ---------- furniture: scale bar, north arrow, honest-data caption ---
  const kmPerPx = 1 / (s * 1000) // s is px per meter
  const km = niceScaleKm(kmPerPx)
  const barPx = km / kmPerPx
  const bx = 14
  const by = MINIMAP_H - 15
  const label = km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`
  parts.push(
    `<g stroke="${INK}" stroke-width="1">` +
      `<line x1="${bx}" y1="${by}" x2="${f1(bx + barPx)}" y2="${by}"/>` +
      `<line x1="${bx}" y1="${by - 2.5}" x2="${bx}" y2="${by}"/>` +
      `<line x1="${f1(bx + barPx)}" y1="${by - 2.5}" x2="${f1(bx + barPx)}" y2="${by}"/>` +
      `</g>`,
    `<text x="${f1(bx + barPx + 4)}" y="${by + 2.5}" font-size="7.5" font-weight="700" fill="${INK}">${label}</text>`,
    `<g transform="translate(${MINIMAP_W - 16},14)">` +
      `<text x="0" y="-3" text-anchor="middle" font-size="8" font-weight="800" fill="${INK}">N</text>` +
      `<path d="M0 0 L3.6 11 L0 8.6 L-3.6 11 Z" fill="${INK}"/>` +
      `</g>`,
    `<text x="${MINIMAP_W - 6}" y="${MINIMAP_H - 5}" text-anchor="end" font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="7" fill="${INK}" fill-opacity="0.55">${CAPTION}</text>`,
  )

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MINIMAP_W} ${MINIMAP_H}" ` +
    `width="${MINIMAP_W}" height="${MINIMAP_H}" role="img" ` +
    `aria-label="Area snapshot — state bounds, existing grid and filed projects from CO-GRID processed data">` +
    `<title>area snapshot — ${CAPTION}</title>` +
    parts.join('') +
    `</svg>`
  )
}
