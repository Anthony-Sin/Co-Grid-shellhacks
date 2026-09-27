/**
 * buildingCells.ts — the tiled-build machinery shared by both building
 * render modes in BuildingsLayer:
 *
 * - TILED: buildings are bucketed into ~12 km grid cells; each cell merges
 *   into its own geometries with its own bounding sphere, so three.js
 *   frustum-culls offscreen cells — zoomed on Savannah skips drawing
 *   Augusta's ~80k buildings entirely (the Google-Maps trick: only render
 *   what's in view).
 * - PROGRESSIVE: useProgressiveCells builds cells one per macrotask
 *   (await setTimeout), so zooming in pops geometry tile-by-tile instead
 *   of freezing the main thread for seconds. The cache is latched —
 *   zooming back out unmounts the meshes but keeps the geometry, like a
 *   tile cache.
 *
 * Two cell flavors share the partition + build loop:
 * - SKETCH cells (mapStyle='sketch'): ~7 color buckets of merged
 *   flat-shaded ExtrudeGeometry + one merged LineSegments of roofline ink.
 * - FLAT cells (mapStyle='flat'): ONE merged ShapeGeometry of plain
 *   footprint fills — no walls, no ink — the web-map "urban density" read.
 *   Far cheaper per building (2D face earcut only), so it earns a lower
 *   zoom gate (see BuildingsLayer).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE } from '../../lib/palette'
import { mulberry32 } from '../../lib/prng'
import type { CityBuilding } from '../../lib/api'
import { polygonShape } from '../shapeUtils'
import { cleanRing } from './cityUtils'
import { renderHeightM, type BuildingIndex } from './zoneHighlight'

// Bucket indices into BUCKET_COLORS — translucent whites (sketch faces)
const GRAY = 0 // +0..2
const WARM = 3 // +0..1
const CIVIC = 5
const INDUSTRIAL = 6

const BUCKET_COLORS = [
  PALETTE.building.grays[0],
  PALETTE.building.grays[1],
  PALETTE.building.grays[2],
  PALETTE.building.warm[0],
  PALETTE.building.warm[1],
  '#ECE7D7', // civic/church — deeper parchment, still in the paper family
  '#E3DFD0', // industrial — deeper warm gray, still monochrome-adjacent
] as const

/** Sketch strokes: extend each segment past its ends (ArcGIS extensionLength). */
const EDGE_OVERSHOOT_M = 1.6
/** Max endpoint jitter — pencil wobble. Scaled by segment length below. */
const EDGE_JITTER_M = 0.55
/** Fraction of ring vertices that also get a vertical wall stroke. */
const WALL_STROKE_P = 0.4

/** Tile edge for the lazy cullable cells — ~12 km squares; a city-zoom
 *  view typically covers 1–4 cells, so most geometry never draws. */
const CELL_M = 12_000

/** Flat-mode footprint fills: neutral muted web-map gray, above the road
 *  stack (roads top out at ~0.38) so blocks read on top of the street
 *  fabric like a tiled basemap. */
export const FLAT_BUILDING_FILL = '#CFCBC0'
export const FLAT_BUILDING_Y = 0.42
/** Flat zone-tint wash rides just above the footprint fills. */
export const FLAT_WASH_Y = 0.48

/** Cell interface shared by both modes — the only contract the
 *  progressive builder needs is `disposables`. */
export interface BuiltCellBase {
  disposables: { dispose(): void }[]
}

/** Extruded bucket meshes + merged ink for ONE grid cell (sketch mode). */
export interface SketchCell extends BuiltCellBase {
  meshes: { geometry: THREE.BufferGeometry; color: string }[]
  ink: THREE.BufferGeometry | null
}

/** One merged footprint fill for ONE grid cell (flat mode). Null when a
 *  cell's rings all fail cleanRing — legitimately empty (water, park). */
export interface FlatCell extends BuiltCellBase {
  geometry: THREE.BufferGeometry | null
}

/** Deterministic color bucket per building: kind bias + id-seeded roll. */
function bucketFor(b: CityBuilding): number {
  const rng = mulberry32(b.id >>> 0)
  const roll = rng()
  const gray = () => GRAY + Math.floor(rng() * 3)
  const warm = () => WARM + Math.floor(rng() * 2)

  switch (b.kind) {
    case 'residential':
      return roll < 0.8 ? gray() : warm()
    case 'commercial':
      return roll < 0.5 ? warm() : gray()
    case 'civic':
      return roll < 0.8 ? CIVIC : gray()
    case 'church':
      return roll < 0.7 ? CIVIC : warm()
    case 'industrial':
      return roll < 0.8 ? INDUSTRIAL : gray()
    default:
      return roll < 0.88 ? gray() : warm()
  }
}

/**
 * Push one jittered, overshot segment. Endpoints are perturbed independently
 * — perfect joins would look plotted, not drawn (AGENTS: hand-drawn look).
 */
function pushStroke(
  out: number[],
  rng: () => number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
) {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-3) return
  const j = Math.min(EDGE_JITTER_M, len * 0.08)
  const over = Math.min(EDGE_OVERSHOOT_M, len * 0.22) / len
  const jx = () => (rng() - 0.5) * 2 * j
  const jz = () => (rng() - 0.5) * 2 * j
  out.push(
    ax - dx * over + jx(),
    ay - dy * over + (rng() - 0.5) * j,
    az - dz * over + jz(),
    bx + dx * over + jx(),
    by + dy * over + (rng() - 0.5) * j,
    bz + dz * over + jz(),
  )
}

/**
 * Group building indices into CELL_M grid cells by footprint centroid
 * (reuses the shared BuildingIndex — no second centroid pass).
 * Buildings with NaN centroids are skipped; they'd fail cleanRing anyway.
 */
export function partitionCells(
  buildings: CityBuilding[],
  index: BuildingIndex,
): Map<string, number[]> {
  const cells = new Map<string, number[]>()
  for (let i = 0; i < buildings.length; i++) {
    const x = index.cx[i]
    const y = index.cy[i]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const key = `${Math.floor(x / CELL_M)},${Math.floor(y / CELL_M)}`
    const cell = cells.get(key)
    if (cell) cell.push(i)
    else cells.set(key, [i])
  }
  return cells
}

/** Extrude one cell's buildings into bucket meshes + merged ink strokes
 *  (sketch mode — the ~7-bucket color spread + roofline/wall pencil ink). */
export function buildSketchCell(buildings: CityBuilding[], indices: number[]): SketchCell {
  const buckets: THREE.BufferGeometry[][] = BUCKET_COLORS.map(() => [])
  const inkVerts: number[] = []

  for (const i of indices) {
    const b = buildings[i]
    const ring = cleanRing(b.footprint)
    if (!ring) continue
    // Filed heights verbatim; assumed fallbacks get seeded variety —
    // see renderHeightM (zoneHighlight.ts) for the filed-vs-assumed split.
    const h = renderHeightM(b)

    const geo = new THREE.ExtrudeGeometry(polygonShape(ring), {
      depth: h,
      bevelEnabled: false,
    })
    // Extrude runs along +Z; rotateX(-90°) stands it up on +Y and maps
    // footprint +y (north) to -z (north = up on screen).
    geo.rotateX(-Math.PI / 2)
    geo.deleteAttribute('uv')
    buckets[bucketFor(b)].push(geo)

    // Sketch ink: roofline ring for every building + a few vertical wall
    // strokes — the "sketch edges" look. A manual outline pass is far cheaper
    // than ~68k EdgesGeometry runs (each would re-run earcut + face angles).
    const rng = mulberry32((b.id >>> 0) ^ 0x5bd1e995)
    const top = h + 0.25 // hair above the roof plane to avoid z-fighting
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k]
      const c = ring[(k + 1) % ring.length]
      pushStroke(inkVerts, rng, a[0], top, -a[1], c[0], top, -c[1])
      if (rng() < WALL_STROKE_P && h > 4) {
        const wallTop = top - 0.4
        const wallBot = top - h * (0.55 + rng() * 0.35)
        pushStroke(inkVerts, rng, a[0], wallTop, -a[1], a[0], wallBot, -a[1])
      }
    }
  }

  const disposables: { dispose(): void }[] = []
  const meshes: SketchCell['meshes'] = []
  buckets.forEach((list, i) => {
    if (!list.length) return
    const merged = mergeGeometries(list, false)
    if (!merged) return
    merged.computeBoundingSphere() // per-cell bounds → frustum culling
    disposables.push(merged)
    meshes.push({ geometry: merged, color: BUCKET_COLORS[i] })
  })

  let ink: THREE.BufferGeometry | null = null
  if (inkVerts.length) {
    ink = new THREE.BufferGeometry()
    ink.setAttribute('position', new THREE.Float32BufferAttribute(inkVerts, 3))
    ink.computeBoundingSphere()
    disposables.push(ink)
  }

  return { meshes, ink, disposables }
}

/** Merge one cell's footprints into a single flat ShapeGeometry (flat
 *  mode — no walls, no ink, one draw call per visible cell). */
export function buildFlatCell(buildings: CityBuilding[], indices: number[]): FlatCell {
  const shapes: THREE.Shape[] = []
  for (const i of indices) {
    const ring = cleanRing(buildings[i].footprint)
    if (!ring) continue
    shapes.push(polygonShape(ring))
  }
  if (!shapes.length) return { geometry: null, disposables: [] }

  const geometry = new THREE.ShapeGeometry(shapes)
  geometry.rotateX(-Math.PI / 2) // +y north -> -z world, faces up
  geometry.deleteAttribute('uv')
  geometry.translate(0, FLAT_BUILDING_Y, 0)
  geometry.computeBoundingSphere() // per-cell bounds → frustum culling
  return { geometry, disposables: [geometry] }
}

/**
 * Lazy progressive cell cache — the tiled-map streaming pattern, shared
 * by the sketch and flat builders so ONE hook serves both modes:
 *
 * - LAZY: nothing builds until `enabled` first opens the gate (latched —
 *   `wanted` stays true so the cache survives the gate closing; zooming
 *   back out unmounts meshes but keeps geometry, like a tile cache).
 * - PROGRESSIVE: cells build one per macrotask so the map stays
 *   interactive while tiles pop in, in stable (deterministic) order.
 * - INCREMENTAL: corridors land one at a time (proximity-gated fetch)
 *   and append to `buildings`, so a fresh array must NOT wipe the tile
 *   cache — cells whose member count is unchanged keep their geometry;
 *   only new/grown cells (re)build. Corridor arrivals are append-only,
 *   so unchanged-count cells are provably identical tiles.
 *
 * `buildOne` must be a stable module-level function (identity is an
 * effect dep). Returns the cell map ref + a tick that bumps per landed
 * cell (read it so React re-renders) + a done flag for shadow refresh.
 */
export function useProgressiveCells<TCell extends BuiltCellBase>(
  buildings: CityBuilding[],
  spatial: BuildingIndex,
  enabled: boolean,
  buildOne: (buildings: CityBuilding[], indices: number[]) => TCell,
): { cells: Map<string, TCell>; tick: number; done: boolean } {
  const [wanted, setWanted] = useState(false)
  useEffect(() => {
    if (enabled) setWanted(true)
  }, [enabled])

  const cellsRef = useRef(new Map<string, TCell>())
  const builtCountRef = useRef(new Map<string, number>())
  const builtForRef = useRef<CityBuilding[] | null>(null)
  const [tick, setTick] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!wanted || builtForRef.current === buildings) return
    let cancelled = false
    setDone(false)

    const queue = [...partitionCells(buildings, spatial).entries()]
    const counts = builtCountRef.current
    const keys = new Set(queue.map(([k]) => k))
    // Cells that vanished entirely (defensive — arrivals are append-only)
    for (const [k, cell] of cellsRef.current) {
      if (!keys.has(k)) {
        for (const d of cell.disposables) d.dispose()
        cellsRef.current.delete(k)
        counts.delete(k)
      }
    }
    const step = async () => {
      // Prioritize nothing — stable order keeps the pop-in deterministic.
      for (const [key, indices] of queue) {
        if (cancelled) return
        if (counts.get(key) === indices.length) continue // cached tile
        await new Promise((r) => setTimeout(r, 0)) // yield between tiles
        if (cancelled) return
        const old = cellsRef.current.get(key)
        if (old) for (const d of old.disposables) d.dispose()
        cellsRef.current.set(key, buildOne(buildings, indices))
        counts.set(key, indices.length)
        setTick((t) => t + 1)
      }
      if (!cancelled) {
        builtForRef.current = buildings
        setDone(true)
      }
    }
    void step()
    return () => {
      cancelled = true // keep built cells — the tile cache survives zoom-out
    }
  }, [buildings, wanted, spatial, buildOne])

  useEffect(
    () => () => {
      for (const cell of cellsRef.current.values()) {
        for (const d of cell.disposables) d.dispose()
      }
      cellsRef.current.clear()
    },
    [],
  )

  return useMemo(
    () => ({ cells: cellsRef.current, tick, done }),
    [tick, done],
  )
}
