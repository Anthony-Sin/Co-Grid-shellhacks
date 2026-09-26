import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE, TIER_COLORS } from '../../lib/palette'
import { mulberry32 } from '../../lib/prng'
import type { CityBuilding } from '../../lib/api'
import { SCENE_CENTERS } from '../../lib/projection'
import { passesMapFilters } from '../../lib/overlapFilters'
import { useAppStore } from '../../state/store'
import { useOverlaps } from '../../ui/hooks/useApiData'
import { mixHex } from '../overlap/zoneData'
import { polygonShape } from '../shapeUtils'
import { cleanRing, useDispose, useShadowRefresh, useZoomAtLeast } from './cityUtils'
import {
  OVERLAY_LIFT_M,
  buildOverlayGeometry,
  buildingsInMask,
  indexBuildings,
  renderHeightM,
  zoneMaskLocal,
  type BuildingIndex,
} from './zoneHighlight'

/**
 * ~148k real OSM footprints across the composited corridors, extruded
 * into merged draw calls — built the way tiled maps stream in:
 *
 * - LAZY: nothing is extruded until the zoom gate opens (or a corridor
 *   scene renders directly). Statewide overview never pays the ~148k
 *   earcut+extrude cost.
 * - TILED: buildings are bucketed into ~12 km grid cells; each cell
 *   merges into its own geometries with its own bounding sphere, so
 *   three.js frustum-culls offscreen cells — zoomed on Savannah skips
 *   drawing Augusta's ~80k buildings entirely (the Google-Maps trick:
 *   only render what's in view).
 * - PROGRESSIVE: cells build one per macrotask (await setTimeout), so
 *   zooming in pops geometry tile-by-tile instead of freezing the main
 *   thread for seconds.
 *
 * Inside each cell the old strategy still applies: ~7 color buckets of
 * merged flat-shaded extrusions + one merged LineSegments of roofline
 * ink (per-building meshes/Edges would be ~10k draw calls). The pencil
 * double-stroke second pass only mounts at street zoom — invisible
 * farther out but still drawn otherwise.
 */

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

/** Tile edge for the lazy cullable cells — ~12 km squares; a city-zoom
 *  view typically covers 1–4 cells, so most geometry never draws. */
const CELL_M = 12_000

/** Extruded bucket meshes + merged ink for ONE grid cell. */
interface BuiltCell {
  meshes: { geometry: THREE.BufferGeometry; color: string }[]
  ink: THREE.BufferGeometry | null
  disposables: { dispose(): void }[]
}

/**
 * Group building indices into CELL_M grid cells by footprint centroid
 * (reuses the shared BuildingIndex — no second centroid pass).
 * Buildings with NaN centroids are skipped; they'd fail cleanRing anyway.
 */
function partitionCells(
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

/** Extrude one cell's buildings into bucket meshes + merged ink strokes. */
function buildCell(buildings: CityBuilding[], indices: number[]): BuiltCell {
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
  const meshes: BuiltCell['meshes'] = []
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

/** Shared props for the two tint shells — the wash sits on the exact
 * base silhouette; polygonOffset beats the coplanar side walls, the
 * +0.4 m lift (OVERLAY_LIFT_M) clears the roof planes. */
function TintShell({
  geometry,
  color,
  opacity,
}: {
  geometry: THREE.BufferGeometry
  color: string
  opacity: number
}) {
  return (
    <mesh
      geometry={geometry}
      position={[0, OVERLAY_LIFT_M, 0]}
      receiveShadow
    >
      <meshStandardMaterial
        color={color}
        flatShading
        roughness={1}
        metalness={0}
        transparent
        opacity={opacity}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  )
}

export function BuildingsLayer({
  buildings,
  detailVisible,
}: {
  buildings: CityBuilding[]
  /** Ortho zoom gate for heavy detail — supplied by CityScene so the
   *  corridor fetch and this layer share one threshold. */
  detailVisible: boolean
}) {
  // In the statewide scene the merged array carries ~148k corridor
  // buildings — at overview zoom they're invisible vertex noise that
  // still costs GPU, so the base meshes + ink unmount below the
  // hysteresis band. The zone-tint TintShells below are NOT gated — a
  // selected zone's "these buildings coordinate" wash is honest signal
  // at ANY zoom.
  const gated = useAppStore((s) => s.activeScene === 'state')
  const showBase = !gated || detailVisible

  // Footprint centroids, computed once — shared by the zone-tint masks
  // AND the cell partitioner, so tiling costs no extra pass.
  const spatial = useMemo(() => indexBuildings(buildings), [buildings])

  // ---- lazy progressive build ---------------------------------------
  // Extrusion only runs once detail is first WANTED (latched — zooming
  // back out unmounts the meshes but keeps the geometry cached, like a
  // tile cache; no re-extrude on the next zoom-in). Cells build one per
  // macrotask so the map stays interactive while tiles pop in. cellsRef
  // holds what's built; buildTick re-renders as each cell lands.
  const [wanted, setWanted] = useState(false)
  useEffect(() => {
    if (showBase) setWanted(true)
  }, [showBase])
  const cellsRef = useRef(new Map<string, BuiltCell>())
  const builtForRef = useRef<CityBuilding[] | null>(null)
  const [buildTick, setBuildTick] = useState(0)
  const [buildDone, setBuildDone] = useState(false)

  useEffect(() => {
    if (!wanted || builtForRef.current === buildings) return
    let cancelled = false
    // Drop geometry baked from a previous buildings array (corridor data
    // landing after a first build rebuilds once — same cell keys).
    for (const cell of cellsRef.current.values()) {
      for (const d of cell.disposables) d.dispose()
    }
    cellsRef.current.clear()
    setBuildDone(false)

    const cells = partitionCells(buildings, spatial)
    const queue = [...cells.entries()]
    const step = async () => {
      // Prioritize nothing — stable order keeps the pop-in deterministic.
      for (const [key, indices] of queue) {
        if (cancelled) return
        await new Promise((r) => setTimeout(r, 0)) // yield between tiles
        if (cancelled) return
        cellsRef.current.set(key, buildCell(buildings, indices))
        setBuildTick((t) => t + 1)
      }
      if (!cancelled) {
        builtForRef.current = buildings
        setBuildDone(true)
      }
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

  useShadowRefresh(buildDone) // one bake once all casters have landed
  // Pencil double-stroke: a second offset ink pass — visible only up
  // close, so it stays unmounted until street zoom (~halves ink cost at
  // city zoom where it reads as noise anyway).
  const streetZoom = useZoomAtLeast(0.035, 0.7)

  // ---- contextual zone tint (ref_img/color_coded_3d_buildign.png) ----
  // Buildings inside the selected overlap's filed zone get a tier-color
  // wash; the hovered overlap gets a fainter second wash (list brushing).
  const zonesOn = useAppStore((s) => s.layers.zones)
  const activeScene = useAppStore((s) => s.activeScene)
  const selectedOverlapId = useAppStore((s) => s.selectedOverlapId)
  const hoveredOverlapId = useAppStore((s) => s.hoveredOverlapId)
  const visibleTiers = useAppStore((s) => s.visibleTiers)
  const utilityFilter = useAppStore((s) => s.utilityFilter)
  const yearFilter = useAppStore((s) => s.yearFilter)
  // Region-wide records — shares the session fetch with panel/zones.
  const { data: overlapsData } = useOverlaps()

  /** Scene-local zone masks for the two records. Honors the same hard
   *  map filters as OverlapZones (a filtered-out record tints nothing —
   *  honest absence), and records with no filed zone_geometry yield no
   *  mask rather than an invented radius. */
  const masks = useMemo(() => {
    // zones layer off → still tint the SELECTED overlap's footprint (the
    // zone polygon itself renders in that case); hover wash needs the layer
    if (!overlapsData || (!zonesOn && !selectedOverlapId)) return { sel: null, hov: null }
    const center = SCENE_CENTERS[activeScene]
    const filters = { visibleTiers, utilityFilter, yearRange: yearFilter }
    const resolve = (id: string | null, exclude?: string | null) => {
      if (!id || id === exclude) return null
      const rec = overlapsData.overlaps.find((o) => o.overlap_id === id)
      if (!rec || !passesMapFilters(rec, filters)) return null
      const mask = zoneMaskLocal(rec, center)
      return mask ? { rec, mask } : null
    }
    return {
      sel: resolve(selectedOverlapId),
      hov: zonesOn ? resolve(hoveredOverlapId, selectedOverlapId) : null,
    }
  }, [
    zonesOn,
    overlapsData,
    activeScene,
    selectedOverlapId,
    hoveredOverlapId,
    visibleTiers,
    utilityFilter,
    yearFilter,
  ])

  // Rebuild only on selection/hover/scene/filter change — the O(n)
  // centroid test is cheap and only the (usually <300) in-zone
  // footprints pay ExtrudeGeometry. Never re-extrudes all ~70k.
  const selShell = useMemo(
    () =>
      masks.sel
        ? buildOverlayGeometry(buildings, buildingsInMask(spatial, masks.sel.mask))
        : null,
    [masks.sel, buildings, spatial],
  )
  const hovShell = useMemo(
    () =>
      masks.hov
        ? buildOverlayGeometry(buildings, buildingsInMask(spatial, masks.hov.mask))
        : null,
    [masks.hov, buildings, spatial],
  )
  useDispose(selShell ? [selShell.geometry] : null)
  useDispose(hovShell ? [hovShell.geometry] : null)

  void buildTick // cells land incrementally; tick forces re-render
  return (
    <group>
      {showBase
        ? [...cellsRef.current.entries()].map(([key, cell]) => (
            <group key={key}>
              {cell.meshes.map((m, i) => (
                <mesh key={i} geometry={m.geometry} castShadow receiveShadow>
                  {/* Sketch faces: white, barely-there — like the ArcGIS
                      sketch renderer's [255,255,255,0.1] fill. */}
                  <meshStandardMaterial
                    color={m.color}
                    flatShading
                    roughness={1}
                    metalness={0}
                    transparent
                    opacity={0.2}
                  />
                </mesh>
              ))}
              {cell.ink ? (
                <lineSegments geometry={cell.ink}>
                  <lineBasicMaterial color={PALETTE.ink} transparent opacity={0.8} />
                </lineSegments>
              ) : null}
              {streetZoom && cell.ink ? (
                /* Second pass, offset a whisker: pencil double-stroke —
                   street zoom only. */
                <lineSegments geometry={cell.ink} position={[0.9, 0.35, 0.55]}>
                  <lineBasicMaterial color={PALETTE.ink} transparent opacity={0.2} />
                </lineSegments>
              ) : null}
            </group>
          ))
        : null}
      {selShell && masks.sel ? (
        <TintShell
          geometry={selShell.geometry}
          color={TIER_COLORS[masks.sel.rec.tier] ?? '#888888'}
          opacity={0.75}
        />
      ) : null}
      {hovShell && masks.hov ? (
        <TintShell
          geometry={hovShell.geometry}
          color={mixHex(TIER_COLORS[masks.hov.rec.tier] ?? '#888888', '#FFFFFF', 0.35)}
          opacity={0.5}
        />
      ) : null}
    </group>
  )
}
