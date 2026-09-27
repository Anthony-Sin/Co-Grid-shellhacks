/**
 * miniMapSat.ts — satellite backdrop for the AREA SNAPSHOT.
 *
 * Split out of miniMapSvg.ts for the 500-line rule (AGENTS.md §1). Owns
 * two things that must agree EXACTLY:
 *
 *   miniFrame(spec)      — the crop box + px/lonLat projections every
 *                          snapshot layer shares (focus + zone + closest
 *                          points, partners only where they reach near
 *                          the core box, ~25% pad, expanded to aspect).
 *   satTiles(spec)       — the Web-mercator Esri World Imagery tiles
 *                          covering that crop, positioned via the same
 *                          projection (NW/SE corners projected
 *                          separately so skew lands in a per-tile
 *                          stretch). The root viewBox clips overhangs.
 *
 * prefetchSatTiles(spec) fetches each tile into TILE_CACHE as a data
 * URI — remote <image href> inside inline SVG rasterizes unreliably
 * under Chromium, and embedded data makes downloaded reports
 * self-contained. Failures are silent: the tile keeps its remote href
 * and the paper land underlay still paints — never a broken image.
 */

import { eachCoord, geomPrims } from './geoPrims'
import type { GeomLike, XY } from './geoPrims'
import { lonLatToLocal, SCENE_CENTERS } from './projection'
import type { Vec2 } from './projection'
import type { MiniMapSpec } from './miniMapSpec'
import { geomBBox } from './miniMapClip'
import type { BBox } from './miniMapClip'

/** Thumbnail viewport — the card CSS scales it to the rail width. */
export const MINIMAP_W = 320
export const MINIMAP_H = 180

/** Free public raster basemap — real satellite photography of the site. */
export const ESRI_TILE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'

/** Shared projection frame — identical to the statewide scene's. */
const C = SCENE_CENTERS.state
const DEG_LON_M = 111320 * Math.cos((C[1] * Math.PI) / 180)
const DEG_LAT_M = 110540

/** Geometry is clipped ~10px past the viewBox so strokes that leave the
 *  frame die off-screen (the viewBox itself is the honest crop edge). */
const BLEED = 10
export const CLIP = [-BLEED, -BLEED, MINIMAP_W + BLEED, MINIMAP_H + BLEED] as const

const MIN_SPAN_M = 4200 // a lone point still lands in ~4km of context
const PAD_F = 0.25 // ~25% margin around the focus bbox

/** Crop-frame math shared by the SVG builder and the satellite tile
 *  prefetcher — both must agree on EXACTLY which lon/lat window the
 *  thumbnail covers, so this is computed once here. */
export function miniFrame(spec: MiniMapSpec) {
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
  return { s, toPxLL, lonAt, latAt, inCrop }
}

/** Web-mercator tiles covering the spec's crop, in svg px. */
export function satTiles(
  spec: MiniMapSpec,
): { url: string; x: number; y: number; w: number; h: number }[] {
  const { toPxLL, lonAt, latAt } = miniFrame(spec)
  const lonW = lonAt(0)
  const lonE = lonAt(MINIMAP_W)
  const latN = latAt(0)
  const latS = latAt(MINIMAP_H)
  const lonSpan = Math.max(1e-6, lonE - lonW)
  // pick z so ~320 CSS px covers the crop longitude span
  let z = Math.round(Math.log2((MINIMAP_W * 360) / (lonSpan * 256)))
  z = Math.max(6, Math.min(15, z))
  const n = 2 ** z
  const txOf = (lon: number) => Math.floor(((lon + 180) / 360) * n)
  const tyOf = (lat: number) => {
    const r = (lat * Math.PI) / 180
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  }
  const lonOf = (tx: number) => (tx / n) * 360 - 180
  const latOf = (ty: number) => {
    const r = Math.PI - (2 * Math.PI * ty) / n
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(r) - Math.exp(-r)))
  }
  const tiles: { url: string; x: number; y: number; w: number; h: number }[] = []
  for (let tx = Math.max(0, txOf(lonW)); tx <= Math.min(n - 1, txOf(lonE)); tx++) {
    for (let ty = Math.max(0, tyOf(latN)); ty <= Math.min(n - 1, tyOf(latS)); ty++) {
      const nw = toPxLL([lonOf(tx), latOf(ty)])
      const se = toPxLL([lonOf(tx + 1), latOf(ty + 1)])
      const w = Math.abs(se[0] - nw[0])
      const h = Math.abs(se[1] - nw[1])
      if (w < 1 || h < 1) continue
      tiles.push({
        url: `${ESRI_TILE}/${z}/${ty}/${tx}`,
        x: Math.min(nw[0], se[0]),
        y: Math.min(nw[1], se[1]),
        w,
        h,
      })
    }
  }
  return tiles
}

/** url -> data URI. */
export const TILE_CACHE = new Map<string, string>()
const TILE_PENDING = new Map<string, Promise<void>>()
const TILE_CACHE_MAX = 400 // ~15MB worst case — evict oldest beyond this

/** Fetch every tile a spec's snapshot needs into TILE_CACHE. Idempotent,
 *  deduped, and failure-tolerant. */
export function prefetchSatTiles(spec: MiniMapSpec): Promise<void> {
  const jobs: Promise<void>[] = []
  for (const t of satTiles(spec)) {
    if (TILE_CACHE.has(t.url)) continue
    let job = TILE_PENDING.get(t.url)
    if (!job) {
      job = fetch(t.url)
        .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
        .then(
          (blob) =>
            new Promise<void>((res) => {
              const fr = new FileReader()
              fr.onload = () => {
                // FIFO eviction — Map preserves insertion order
                if (TILE_CACHE.size >= TILE_CACHE_MAX)
                  TILE_CACHE.delete(TILE_CACHE.keys().next().value!)
                TILE_CACHE.set(t.url, String(fr.result))
                res()
              }
              fr.onerror = () => res()
              fr.readAsDataURL(blob)
            }),
        )
        .catch(() => undefined)
        .finally(() => TILE_PENDING.delete(t.url))
      TILE_PENDING.set(t.url, job)
    }
    jobs.push(job)
  }
  return Promise.all(jobs).then(() => undefined)
}
