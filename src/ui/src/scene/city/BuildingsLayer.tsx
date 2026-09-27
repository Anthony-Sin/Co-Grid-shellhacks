import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import { TIER_COLORS } from '../../lib/palette'
import type { CityBuilding } from '../../lib/api'
import { SCENE_CENTERS } from '../../lib/projection'
import { passesMapFilters } from '../../lib/overlapFilters'
import { useAppStore } from '../../state/store'
import { useOverlaps } from '../../ui/hooks/useApiData'
import { mixHex } from '../overlap/zoneData'
import { useDispose } from './cityUtils'
import { FLAT_BUILDING_FILL, FLAT_WASH_Y, useFlatCells } from './buildingCells'
import {
  buildOverlayGeometry,
  buildingsInMask,
  indexBuildings,
  zoneMaskLocal,
} from './zoneHighlight'

/**
 * ~460k real OSM footprints across the composited corridors — built the
 * way tiled maps stream in (LAZY zoom gate → TILED ~12 km cells →
 * PROGRESSIVE one-cell-per-macrotask builds, cached across zoom-outs).
 * The machinery lives in buildingCells.ts; this component wires it up.
 *
 * One render mode only: merged 2D ShapeGeometry footprint fills per cell
 * — neutral muted gray, unlit — the "Google-Maps density" read. The 3D
 * extrusion mode was dropped (user feedback: slow, unwanted); both map
 * styles share this ONE flat layer, so toggling styles never rebuilds.
 *
 * The zone-tint wash is NOT gated — a selected zone's "these buildings
 * coordinate" signal is honest at ANY zoom. It's a flat ShapeGeometry
 * fill riding just above the base fills (FLAT_WASH_Y).
 */

/** Tier wash — unlit ShapeGeometry fill floating just above the
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
}: {
  buildings: CityBuilding[]
  /** Ortho zoom gate for the footprint fills — supplied by CityScene so
   *  the corridor fetch prefetch and the render gate share one ramp. */
  detailVisible: boolean
}) {
  // In the statewide scene the merged array carries ~460k corridor
  // buildings — at overview zoom they're invisible vertex noise that
  // still costs GPU, so the fills unmount below the hysteresis band.
  // Corridor scenes (gated=false) always show.
  const gated = useAppStore((s) => s.activeScene === 'state')
  const showBase = !gated || detailVisible

  // Footprint centroids, computed once — shared by the zone-tint masks
  // AND the cell partitioner, so tiling costs no extra pass.
  const spatial = useMemo(() => indexBuildings(buildings), [buildings])

  // ---- lazy progressive build ---------------------------------------
  // One cache, latched on first use — survives zoom-outs AND style
  // toggles (flat↔sketch share this layer, so nothing re-triangulates).
  const flatCells = useFlatCells(buildings, spatial, showBase)

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
  // footprints pay the geometry cost. Never re-triangulates all ~460k.
  const selShell = useMemo(() => {
    if (!masks.sel) return null
    const hits = buildingsInMask(spatial, masks.sel.mask)
    return buildOverlayGeometry(buildings, hits)
  }, [masks.sel, buildings, spatial])
  const hovShell = useMemo(() => {
    if (!masks.hov) return null
    const hits = buildingsInMask(spatial, masks.hov.mask)
    return buildOverlayGeometry(buildings, hits)
  }, [masks.hov, buildings, spatial])
  useDispose(selShell ? [selShell.geometry] : null)
  useDispose(hovShell ? [hovShell.geometry] : null)

  // Cells land incrementally; reading the tick forces a re-render per cell.
  const tick = flatCells.tick
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
      flat: number
      showBase: boolean
      tintSel: number
      tintHov: number
    }
  }).__cogridCellCounts = {
    flat: flatCells.cells.size,
    showBase,
    tintSel: selShell?.count ?? 0,
    tintHov: hovShell?.count ?? 0,
  }

  return (
    <group>
      {showBase
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
        <FlatWash
          geometry={selShell.geometry}
          color={TIER_COLORS[masks.sel.rec.tier] ?? '#888888'}
          opacity={0.6}
        />
      ) : null}
      {hovShell && masks.hov ? (
        <FlatWash
          geometry={hovShell.geometry}
          color={mixHex(TIER_COLORS[masks.hov.rec.tier] ?? '#888888', '#FFFFFF', 0.35)}
          opacity={0.4}
        />
      ) : null}
    </group>
  )
}
