/**
 * buildingCells.ts — the tiled-build machinery behind the building layer:
 *
 * - TILED: buildings are bucketed into ~12 km grid cells; each cell merges
 *   into one ShapeGeometry with its own bounding sphere, so three.js
 *   frustum-culls offscreen cells — zoomed on Savannah skips drawing
 *   Augusta's ~80k buildings entirely (the Google-Maps trick: only render
 *   what's in view).
 * - PROGRESSIVE: useFlatCells builds cells one per macrotask
 *   (await setTimeout), so zooming in pops geometry tile-by-tile instead
 *   of freezing the main thread for seconds. The cache is latched —
 *   zooming back out unmounts the meshes but keeps the geometry, like a
 *   tile cache.
 *
 * One cell flavor only: merged 2D footprint fills — no walls, no ink —
 * the web-map "urban density" read, in BOTH map styles (the 3D extrusion
 * mode was dropped: slow to build and unwanted). 2D face earcut is far
 * cheaper per building, so fills earn a low zoom gate (corridorComposite).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { CityBuilding } from '../../lib/api'
import { polygonShape } from '../shapeUtils'
import { cleanRing } from './cityUtils'
import { isAppendGrowth, type BuildingIndex } from './zoneHighlight'

/** Tile edge for the lazy cullable cells — ~12 km squares; a city-zoom
 *  view typically covers 1–4 cells, so most geometry never draws. */
const CELL_M = 12_000

/** Footprint fills: neutral muted web-map gray, above the road stack
 *  (roads top out at ~0.38) so blocks read on top of the street fabric
 *  like a tiled basemap. */
export const FLAT_BUILDING_FILL = '#CFCBC0'
const FLAT_BUILDING_Y = 0.42
/** Zone-tint wash rides just above the footprint fills. */
export const FLAT_WASH_Y = 0.48

/** One merged footprint fill for ONE grid cell. Null when a cell's rings
 *  all fail cleanRing — legitimately empty (water, park). */
export interface FlatCell {
  geometry: THREE.BufferGeometry | null
  disposables: { dispose(): void }[]
}

/**
 * Append-only partition cache — same growth pattern as indexBuildings:
 * corridor arrivals concatenate a fresh `buildings` array (stable prefix
 * refs, new tail), so re-bucketing all ~460k centroids per arrival is
 * wasted work. A grown array buckets only the tail; existing index lists
 * grow IN PLACE, which is exactly what the tile cache below diffs on
 * (grown member count → that cell rebuilds, untouched cells keep their
 * geometry). A shrunk/mismatched prefix (scene switch) rebuilds once.
 */
let partCache: { arr: CityBuilding[]; len: number; cells: Map<string, number[]> } | null = null

/**
 * Group building indices into CELL_M grid cells by footprint centroid
 * (reuses the shared BuildingIndex — no second centroid pass).
 * Buildings with NaN centroids are skipped; they'd fail cleanRing anyway.
 */
export function partitionCells(
  buildings: CityBuilding[],
  index: BuildingIndex,
): Map<string, number[]> {
  const n = buildings.length
  const cache = partCache
  // index must cover the array — a stale/sparser index would key NaN
  const extend =
    cache !== null && index.cx.length >= n && isAppendGrowth(cache.arr, cache.len, buildings)
  const cells = extend ? cache.cells : new Map<string, number[]>()
  const from = extend ? cache.len : 0
  for (let i = from; i < n; i++) {
    const x = index.cx[i]
    const y = index.cy[i]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const key = `${Math.floor(x / CELL_M)},${Math.floor(y / CELL_M)}`
    const cell = cells.get(key)
    if (cell) cell.push(i)
    else cells.set(key, [i])
  }
  partCache = { arr: buildings, len: n, cells }
  return cells
}

/** Footprints merged per earcut batch inside one cell — a dense metro
 *  cell can hold 20–50k footprints; triangulating them in ONE
 *  ShapeGeometry call was a 100–400 ms synchronous macrotask (the
 *  audit's zoom stall). ~5k per chunk keeps each slice in the ~10–30 ms
 *  range; the chunks then merge into the single geometry the tile cache
 *  keys on, so draw-call count is unchanged. */
const FLAT_CELL_CHUNK = 5_000

/** Merge one cell's footprints into a single flat ShapeGeometry — no
 *  walls, no ink, one draw call per visible cell. ASYNC: yields a
 *  macrotask between chunks (same setTimeout pattern as the per-cell
 *  pacing in useFlatCells) so a dense cell can't monopolize a frame.
 *  Returns null when `cancelled` flips mid-build — partial chunk
 *  geometries are disposed here so the caller simply skips caching and
 *  the cell rebuilds cleanly on the next run. */
export async function buildFlatCell(
  buildings: CityBuilding[],
  indices: number[],
  cancelled: () => boolean,
): Promise<FlatCell | null> {
  const parts: THREE.BufferGeometry[] = []
  const bail = (): null => {
    for (const p of parts) p.dispose()
    return null
  }

  for (let off = 0; off < indices.length; off += FLAT_CELL_CHUNK) {
    if (cancelled()) return bail()
    const end = Math.min(off + FLAT_CELL_CHUNK, indices.length)
    const shapes: THREE.Shape[] = []
    for (let k = off; k < end; k++) {
      const ring = cleanRing(buildings[indices[k]].footprint)
      if (!ring) continue
      shapes.push(polygonShape(ring))
    }
    if (shapes.length) {
      const part = new THREE.ShapeGeometry(shapes)
      part.deleteAttribute('uv') // identical attribute sets → mergeable
      parts.push(part)
    }
    await new Promise((r) => setTimeout(r, 0)) // yield between chunks
  }
  if (cancelled()) return bail()
  if (!parts.length) return { geometry: null, disposables: [] }

  // One chunk skips the merge entirely; several merge into the cell's
  // single BufferGeometry (mergeGeometries copies — parts get disposed).
  const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false)
  if (!geometry) {
    for (const p of parts) p.dispose()
    return { geometry: null, disposables: [] }
  }
  if (geometry !== parts[0]) for (const p of parts) p.dispose()
  geometry.rotateX(-Math.PI / 2) // +y north -> -z world, faces up
  geometry.translate(0, FLAT_BUILDING_Y, 0)
  geometry.computeBoundingSphere() // per-cell bounds → frustum culling
  return { geometry, disposables: [geometry] }
}

/**
 * Lazy progressive cell cache — the tiled-map streaming pattern:
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
 * Returns the cell map + a tick that bumps per landed cell (read it so
 * React re-renders).
 */
export function useFlatCells(
  buildings: CityBuilding[],
  spatial: BuildingIndex,
  enabled: boolean,
): { cells: Map<string, FlatCell>; tick: number } {
  const [wanted, setWanted] = useState(false)
  useEffect(() => {
    if (enabled) setWanted(true)
  }, [enabled])

  const cellsRef = useRef(new Map<string, FlatCell>())
  const builtCountRef = useRef(new Map<string, number>())
  const builtForRef = useRef<CityBuilding[] | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!wanted || builtForRef.current === buildings) return
    let cancelled = false

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
        // buildFlatCell yields mid-cell too (dense metros) — it returns
        // null on cancellation with partials already disposed, and a
        // completed cell that lands stale is disposed rather than cached.
        const cell = await buildFlatCell(buildings, indices, () => cancelled)
        if (!cell) return
        if (cancelled) {
          for (const d of cell.disposables) d.dispose()
          return
        }
        const old = cellsRef.current.get(key)
        if (old) for (const d of old.disposables) d.dispose()
        cellsRef.current.set(key, cell)
        counts.set(key, indices.length)
        setTick((t) => t + 1)
      }
      if (!cancelled) builtForRef.current = buildings
    }
    void step()
    return () => {
      cancelled = true // keep built cells — the tile cache survives zoom-out
    }
  }, [buildings, wanted, spatial])

  useEffect(
    () => () => {
      for (const cell of cellsRef.current.values()) {
        for (const d of cell.disposables) d.dispose()
      }
      cellsRef.current.clear()
    },
    [],
  )

  return useMemo(() => ({ cells: cellsRef.current, tick }), [tick])
}
