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
 * `selected` raises the zone and pushes opacities to full; `dimmed` drops
 * everything to ~40% while another overlap is selected.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { PALETTE, TIER_COLORS } from '../../lib/palette'
import { polygonShape } from '../shapeUtils'
import { mixHex, type ZoneDatum } from './zoneData'

/** Flat-plane heights (meters) — see CityCanvas ground/buildings context. */
const BASE_H = 7
const RAISED_H = 16
/** Opacity multiplier while another overlap is selected. */
const DIM_FACTOR = 0.4
/** Local z lifts inside the rotated group → real vertical separation. */
const Z_FILL = 0
const Z_HATCH = 0.6
const Z_BORDER = 1.2
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
  /** True → fill+hatch hidden, only a thin dashed outline is drawn. */
  outlineOnly: boolean
}

export function ZonePolygon({ datum, dimmed, selected, outlineOnly }: ZonePolygonProps) {
  const color = TIER_COLORS[datum.rec.tier]
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

  // Idle motion: zones rise gently on mount / when selected; hatch breathes.
  useFrame((state, dt) => {
    const g = groupRef.current
    if (g) {
      const target = selected ? RAISED_H : BASE_H
      g.position.y += (target - g.position.y) * Math.min(1, dt * 5)
    }
    const m = hatchMat.current
    if (m) {
      const breathe = 1 + 0.12 * Math.sin(state.clock.elapsedTime * 1.4 + datum.phase)
      const base = selected ? Math.max(0.55, hatchBase) : hatchBase
      m.opacity = Math.min(1, base * breathe + (selected ? 0.08 : 0)) * dimF * sizeF
    }
  })

  if (!datum.ringLocal) return null // no zone geometry filed — connector still shows

  const fillOpacity = (outlineOnly ? 0 : selected ? 0.3 : fillBase) * dimF * sizeF
  const borderOpacity = (outlineOnly ? 0.6 : selected ? 1 : 0.95) * dimF
  const hatchOpacity = (selected ? Math.max(0.55, hatchBase) : hatchBase) * dimF * sizeF

  return (
    <group ref={groupRef} rotation-x={-Math.PI / 2}>
      {/* translucent affected-area fill */}
      {!outlineOnly && fillGeom && (
        <mesh geometry={fillGeom} position-z={Z_FILL} renderOrder={10}>
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

      {/* ink border — solid normally; thin dashes when merely flagged */}
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
        />
      ) : (
        <Line
          points={borderPts}
          color={ink}
          lineWidth={1.75}
          transparent
          opacity={borderOpacity}
        />
      )}
    </group>
  )
}
