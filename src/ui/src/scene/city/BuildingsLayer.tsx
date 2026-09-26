import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PALETTE, TIER_COLORS } from '../../lib/palette'
import type { CityBuilding } from '../../lib/api'
import { SCENE_CENTERS } from '../../lib/projection'
import { passesMapFilters } from '../../lib/overlapFilters'
import { useAppStore } from '../../state/store'
import { useOverlaps } from '../../ui/hooks/useApiData'
import { mixHex } from '../overlap/zoneData'
import { useDispose, useShadowRefresh, useZoomAtLeast } from './cityUtils'
import {
  FLAT_BUILDING_FILL,
  FLAT_WASH_Y,
  buildFlatCell,
  buildSketchCell,
  useProgressiveCells,
} from './buildingCells'
import {
  OVERLAY_LIFT_M,
  buildFlatOverlayGeometry,
  buildOverlayGeometry,
  buildingsInMask,
  indexBuildings,
  zoneMaskLocal,
} from './zoneHighlight'

/**
 * ~148k real OSM footprints across the composited corridors — built the
 * way tiled maps stream in (LAZY zoom gate → TILED ~12 km cells →
 * PROGRESSIVE one-cell-per-macrotask builds, cached across zoom-outs).
 * The machinery lives in buildingCells.ts; this component wires it to
 * the two render modes:
 *
 * - SKETCH: ~7 color buckets of merged flat-shaded extrusions + one
 *   merged LineSegments of roofline ink per cell (the hand-drawn city).
 * - FLAT: one merged ShapeGeometry of footprint fills per cell — neutral
 *   muted gray, unlit — the "Google-Maps density" read. 2D fills cost a
 *   fraction of an extrusion (no walls, no ink), so flat mode earns a
 *   LOWER zoom gate: fills appear at ~0.006 where extrusions wait for
 *   ~0.008, and both keep their tile caches when zoomed back out.
 *
 * The zone-tint shells are NOT gated in either mode — a selected zone's
 * "these buildings coordinate" wash is honest signal at ANY zoom. Sketch
 * gets the extruded TintShell; flat gets a flat ShapeGeometry wash.
 */

/** Flat footprint fills open at zoom 0.006 — LOWER than the sketch
 *  corridor gate (0.008) since ShapeGeometry is far cheaper. Hysteresis:
 *  ratio 0.75 → hides again below 0.0045, so the band edge doesn't flicker. */
const FLAT_ZOOM_SHOW = 0.006
const FLAT_ZOOM_RATIO = 0.75

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

/** Flat-mode tier wash — unlit ShapeGeometry fill floating just above the
 * footprint fills (FLAT_WASH_Y); depth resolves ordering, no polygonOffset. */
function FlatWash({
  geometry,
  color,
  opacity,
}: {
  geometry: THREE.BufferGeometry
  color: string
  opacity: number
}) {
  return (
    <mesh geometry={geometry} position={[0, FLAT_WASH_Y, 0]}>
      <meshBasicMaterial color={color} transparent opacity={opacity} />
    </mesh>
  )
}

export function BuildingsLayer({
  buildings,
  detailVisible,
  flat = false,
}: {
  buildings: CityBuilding[]
  /** Ortho zoom gate for heavy 3D detail — supplied by CityScene so the
   *  corridor fetch and the sketch layer share one threshold. */
  detailVisible: boolean
  /** mapStyle='flat' → 2D footprint fills instead of extrusions. */
  flat?: boolean
}) {
  // In the statewide scene the merged array carries ~148k corridor
  // buildings — at overview zoom they're invisible vertex noise that
  // still costs GPU, so the base meshes/fills unmount below the
  // hysteresis band. Sketch rides the shared corridor gate; flat uses
  // its own lower one. Corridor scenes (gated=false) always show.
  const gated = useAppStore((s) => s.activeScene === 'state')
  const flatZoomed = useZoomAtLeast(FLAT_ZOOM_SHOW, FLAT_ZOOM_RATIO)
  const showBase = !gated || (flat ? flatZoomed : detailVisible)

  // Footprint centroids, computed once — shared by the zone-tint masks
  // AND the cell partitioner, so tiling costs no extra pass.
  const spatial = useMemo(() => indexBuildings(buildings), [buildings])

  // ---- lazy progressive build ---------------------------------------
  // One cache per mode (each latches on first use and survives zoom-outs
  // AND style toggles — switching flat↔sketch never re-extrudes). Only
  // the active mode's cells render.
  const sketchCells = useProgressiveCells(
    buildings,
    spatial,
    showBase && !flat,
    buildSketchCell,
  )
  const flatCells = useProgressiveCells(
    buildings,
    spatial,
    showBase && flat,
    buildFlatCell,
  )

  // One shadow bake once each cache's casters have landed. Flat fills
  // don't cast, but a baked-when-empty shadow map is harmless.
  useShadowRefresh(sketchCells.done || flatCells.done)

  // Pencil double-stroke: a second offset ink pass — visible only up
  // close, so it stays unmounted until street zoom (~halves ink cost at
  // city zoom where it reads as noise anyway). Sketch mode only.
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

  // Rebuild only on selection/hover/scene/filter/mode change — the O(n)
  // centroid test is cheap and only the (usually <300) in-zone
  // footprints pay the geometry cost. Never re-extrudes all ~70k.
  const selShell = useMemo(() => {
    if (!masks.sel) return null
    const hits = buildingsInMask(spatial, masks.sel.mask)
    return flat
      ? buildFlatOverlayGeometry(buildings, hits)
      : buildOverlayGeometry(buildings, hits)
  }, [masks.sel, buildings, spatial, flat])
  const hovShell = useMemo(() => {
    if (!masks.hov) return null
    const hits = buildingsInMask(spatial, masks.hov.mask)
    return flat
      ? buildFlatOverlayGeometry(buildings, hits)
      : buildOverlayGeometry(buildings, hits)
  }, [masks.hov, buildings, spatial, flat])
  useDispose(selShell ? [selShell.geometry] : null)
  useDispose(hovShell ? [hovShell.geometry] : null)

  // Cells land incrementally; reading the ticks forces a re-render per cell.
  const tick = sketchCells.tick + flatCells.tick
  void tick

  // Debug telemetry for headless captures — same pattern as the
  // __cogridZoom/__cogridCam handles in corridorComposite.ts. The gl
  // handle lets scripts read renderer.info (drawn-tri counts) to prove
  // fills actually rasterize, not just exist.
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    ;(window as unknown as { __cogridGl?: unknown }).__cogridGl = gl
  }, [gl])
  ;(window as unknown as {
    __cogridCellCounts?: {
      sketch: number
      flat: number
      showBase: boolean
      tintSel: number
      tintHov: number
    }
  }).__cogridCellCounts = {
    sketch: sketchCells.cells.size,
    flat: flatCells.cells.size,
    showBase,
    tintSel: selShell?.count ?? 0,
    tintHov: hovShell?.count ?? 0,
  }

  return (
    <group>
      {showBase && !flat
        ? [...sketchCells.cells.entries()].map(([key, cell]) => (
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
      {showBase && flat
        ? [...flatCells.cells.entries()].map(([key, cell]) =>
            cell.geometry ? (
              <mesh key={key} geometry={cell.geometry}>
                {/* Unlit fill — flatShading is meaningless for a coplanar
                    2D face; basic material renders the exact palette hex. */}
                <meshBasicMaterial
                  color={FLAT_BUILDING_FILL}
                  transparent
                  opacity={0.85}
                />
              </mesh>
            ) : null,
          )
        : null}
      {selShell && masks.sel ? (
        flat ? (
          <FlatWash
            geometry={selShell.geometry}
            color={TIER_COLORS[masks.sel.rec.tier] ?? '#888888'}
            opacity={0.6}
          />
        ) : (
          <TintShell
            geometry={selShell.geometry}
            color={TIER_COLORS[masks.sel.rec.tier] ?? '#888888'}
            opacity={0.75}
          />
        )
      ) : null}
      {hovShell && masks.hov ? (
        flat ? (
          <FlatWash
            geometry={hovShell.geometry}
            color={mixHex(TIER_COLORS[masks.hov.rec.tier] ?? '#888888', '#FFFFFF', 0.35)}
            opacity={0.4}
          />
        ) : (
          <TintShell
            geometry={hovShell.geometry}
            color={mixHex(TIER_COLORS[masks.hov.rec.tier] ?? '#888888', '#FFFFFF', 0.35)}
            opacity={0.5}
          />
        )
      ) : null}
    </group>
  )
}
