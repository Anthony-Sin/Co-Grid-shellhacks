/**
 * ZonePolygon — the hatched "affected area" polygon for one overlap.
 *
 * Rendered flat at y≈7 (above ground/roads, below buildings) inside a
 * -90° X-rotated group so children use planar local-meter coords
 * ([x, y] → world [x, h, -y]):
 *   • translucent fill (tier color, ~0.35 opacity)
 *   • merged diagonal hatch LineSegments (signature look, breathing opacity)
 *   • ink outline — solid, or thin+dashed when the record is only being
 *     flagged (timelineOnly filter: `timeline_overlap=false` stays honest —
 *     outlined, not erased, per AGENTS.md §7).
 *
 * `selected` raises the zone and pushes opacities to full; `highlighted`
 * (list/map hover brushing) eases ~70% of the way toward that styling;
 * `dimmed` drops everything to ~40% while another overlap is selected.
 *
 * Interaction: an invisible catch-plane (same ShapeGeometry, opacity 0 —
 * the translucent fill alone raycasts unreliably) reports clicks to
 * selectOverlap() and hover to setHoveredOverlap() for list↔map brushing.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { PALETTE, TIER_COLORS } from '../../lib/palette'
import { selectOverlapInScene } from '../../lib/selectOverlap'
import { useAppStore } from '../../state/store'
import { polygonShape } from '../shapeUtils'
import { mixHex, type ZoneDatum } from './zoneData'

/** Flat-plane heights (meters) — see CityCanvas ground/buildings context. */
const BASE_H = 7
const RAISED_H = 16
/** Fraction of the full "selected" treatment used for hover-highlighting. */
const HIGHLIGHT_F = 0.7
/** Opacity multiplier while another overlap is selected. */
const DIM_FACTOR = 0.4
/** Local z lifts inside the rotated group → real vertical separation. */
const Z_FILL = 0
const Z_HATCH = 0.6
const Z_BORDER = 1.2
/** Invisible event-catcher sits just above the border. */
const Z_CATCH = 1.6
/**
 * Tier-scaled fill/hatch strength — tier-4 zones are ~40km capsules; without
 * scaling, dozens of stacked fills saturate to a solid wash over the map.
 * The hatch stays visible at every tier (the signature look), the fill fades.
 */
const FILL_BY_TIER: Record<number, number> = { 1: 0.34, 2: 0.22, 3: 0.11, 4: 0.05 }
const HATCH_BY_TIER: Record<number, number> = { 1: 0.9, 2: 0.8, 3: 0.6, 4: 0.42 }

export interface ZonePolygonProps {
  datum: ZoneDatum
  dimmed: boolean
  selected: boolean
  /** Hover-brushed from the list/map — ~70% of the selected styling. */
  highlighted: boolean
  /** True → fill+hatch hidden, only a thin dashed outline is drawn. */
  outlineOnly: boolean
}

export function ZonePolygon({ datum, dimmed, selected, highlighted, outlineOnly }: ZonePolygonProps) {
  const color = TIER_COLORS[datum.rec.tier] ?? '#888888'
  const ink = useMemo(() => mixHex(color, PALETTE.ink, 0.55), [color])
  const groupRef = useRef<THREE.Group>(null)
  const hatchMat = useRef<THREE.LineBasicMaterial>(null)

  // Translucent fill — ShapeGeometry from the local-meter ring.
  const fillGeom = useMemo(
    () => (datum.ringLocal ? new THREE.ShapeGeometry(polygonShape(datum.ringLocal)) : null),
    [datum],
  )

  // One merged LineSegments holding every hatch line (x,y pairs → xyz @ z=0).
  const hatchGeom = useMemo(() => {
    if (datum.hatch.length === 0) return null
    const pos = new Float32Array((datum.hatch.length / 2) * 3)
    for (let i = 0, j = 0; i < datum.hatch.length; i += 2, j += 3) {
      pos[j] = datum.hatch[i]
      pos[j + 1] = datum.hatch[i + 1]
      pos[j + 2] = 0
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [datum])

  // Closed planar ring for the drei <Line> border (solid or dashed). The
  // border's vertical lift is baked into the points' z — drei <Line> spreads
  // unknown props onto the material too, so `position-z` is unsafe there.
  const borderPts = useMemo(() => {
    if (!datum.ringLocal) return []
    const pts = [...datum.ringLocal, datum.ringLocal[0]]
    return pts.map(([x, y]) => [x, y, Z_BORDER] as [number, number, number])
  }, [datum])

  // Free replaced GPU buffers (datum identity changes per scene/record).
  useEffect(() => {
    return () => {
      fillGeom?.dispose()
      hatchGeom?.dispose()
    }
  }, [fillGeom, hatchGeom])

  const dimF = dimmed ? DIM_FACTOR : 1
  const fillBase = FILL_BY_TIER[datum.rec.tier] ?? 0.1
  const hatchBase = HATCH_BY_TIER[datum.rec.tier] ?? 0.6
  /** Zones spanning kilometers get toned down so markup never floods. */
  const sizeF = datum.radiusM > 5000 ? 0.5 : datum.radiusM > 2500 ? 0.7 : 1
  /** Hover-brush strength: 1 selected, ~0.7 hovered, 0 at rest. Selected
   *  dominates — hovering another zone never dims a selection. */
  const boost = selected ? 1 : highlighted ? HIGHLIGHT_F : 0
  /** The floor `selected` lifts the hatch to (small tiers get more pop). */
  const hatchFull = Math.max(0.55, hatchBase)

  // Click selects; hover drives list↔map brushing. getState() inside the
  // handlers keeps this component unsubscribed — `highlighted` is a prop.
  const onSelect = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    selectOverlapInScene(datum.rec.overlap_id, datum.rec.zone)
  }
  const onHover = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    useAppStore.getState().setHoveredOverlap(datum.rec.overlap_id)
  }
  const onUnhover = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    // only clear if WE still own the hover — overlapping catch-planes can
    // fire out-of-order and clobber a newer hover
    if (useAppStore.getState().hoveredOverlapId === datum.rec.overlap_id) {
      useAppStore.getState().setHoveredOverlap(null)
    }
  }

  // Idle motion: zones rise gently on mount / when selected; hatch breathes.
  useFrame((state, dt) => {
    const g = groupRef.current
    if (g) {
      const target = BASE_H + (RAISED_H - BASE_H) * boost
      g.position.y += (target - g.position.y) * Math.min(1, dt * 5)
    }
    const m = hatchMat.current
    if (m) {
      const breathe = 1 + 0.12 * Math.sin(state.clock.elapsedTime * 1.4 + datum.phase)
      const base = hatchBase + (hatchFull - hatchBase) * boost
      m.opacity = Math.min(1, base * breathe + 0.08 * boost) * dimF * sizeF
    }
  })

  if (!datum.ringLocal) return null // no zone geometry filed — connector still shows

  const fillOpacity = (outlineOnly ? 0 : fillBase + (0.3 - fillBase) * boost) * dimF * sizeF
  const borderOpacity = (outlineOnly ? 0.6 : 0.95 + 0.05 * boost) * dimF
  const hatchOpacity = (hatchBase + (hatchFull - hatchBase) * boost) * dimF * sizeF

  return (
    <group ref={groupRef} rotation-x={-Math.PI / 2}>
      {/* invisible catch-plane: reliable click/hover target even where the
          fill is nearly transparent (also covers outlineOnly interiors) */}
      {fillGeom && (
        <mesh
          geometry={fillGeom}
          position-z={Z_CATCH}
          onClick={onSelect}
          onPointerOver={onHover}
          onPointerOut={onUnhover}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

      {/* translucent affected-area fill */}
      {!outlineOnly && fillGeom && (
        <mesh
          geometry={fillGeom}
          position-z={Z_FILL}
          renderOrder={10}
          onClick={onSelect}
        >
          <meshBasicMaterial
            color={color}
            transparent
            opacity={fillOpacity}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-2}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* signature diagonal hatching — one merged LineSegments */}
      {!outlineOnly && hatchGeom && (
        <lineSegments geometry={hatchGeom} position-z={Z_HATCH} renderOrder={11}>
          <lineBasicMaterial
            ref={hatchMat}
            color={color}
            transparent
            opacity={hatchOpacity}
            depthWrite={false}
          />
        </lineSegments>
      )}

      {/* ink border — solid normally; thin dashes when merely flagged
          (clickable either way — flagged zones are still real records) */}
      {outlineOnly ? (
        <Line
          points={borderPts}
          color={ink}
          lineWidth={1.25}
          dashed
          dashSize={110}
          gapSize={80}
          transparent
          opacity={borderOpacity}
          onClick={onSelect}
        />
      ) : (
        <Line
          points={borderPts}
          color={ink}
          lineWidth={1.75}
          transparent
          opacity={borderOpacity}
          onClick={onSelect}
        />
      )}
    </group>
  )
}
